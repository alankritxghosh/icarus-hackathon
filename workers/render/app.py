"""
Bakes the light of a whole Icarus building with Blender Cycles on a Modal GPU, for "Make it real".

The browser exports the building as a GLB with light-map coordinates on every floor, wall, ceiling, door and frame,
plus the camera the visitor is looking through. This worker imports it, lights it with a sky, a sun and the model's
own lamps, path-traces the diffuse light falling on each of those surfaces, and returns one light map per surface.
The camera only meters the exposure. It owns no scene state and adds nothing to the model.

Deploying creates a Modal app and a secret in the author's workspace:

    modal secret create icarus-render RENDER_WORKER_TOKEN=<a long random string>
    modal deploy app.py

Then give the edge Worker the printed URL and the same token (`RENDER_WORKER_URL`, `RENDER_WORKER_TOKEN`).
"""

from __future__ import annotations

import base64
import hmac
import json
import math
import os
import tempfile
import time

import modal

MAX_GLB_BYTES = 60 * 1024 * 1024

app = modal.App("icarus-render")
# Blender as a Python module. bpy 4.2 (LTS) is built for Python 3.11 only. The X and GL libraries are what the wheel
# links against even when nothing is displayed.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libxi6", "libxxf86vm1", "libxfixes3", "libxrender1", "libgl1", "libsm6", "libxkbcommon0", "libgomp1")
    .pip_install("bpy==4.2.0", "fastapi[standard]")
)


def parse_view(raw: str) -> dict:
    """The camera and picture size the browser asked for. Raises ValueError when anything is missing or absurd."""
    try:
        view = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError("the view is not JSON") from e

    def vec(name: str) -> list[float]:
        v = view.get(name)
        if not (isinstance(v, list) and len(v) == 3 and all(isinstance(x, (int, float)) and math.isfinite(x) and abs(x) < 1e4 for x in v)):
            raise ValueError(f"{name} must be three finite numbers")
        return [float(x) for x in v]

    out = {"position": vec("position"), "target": vec("target"), "sun": vec("sun")}
    fov = view.get("fov")
    if not (isinstance(fov, (int, float)) and 10 <= fov <= 120):
        raise ValueError("fov must be 10 to 120 degrees")
    out["fov"] = float(fov)
    if view.get("kind") != "light":
        raise ValueError("kind must be light")
    for key, low, high in (("width", 64, 2400), ("height", 64, 2400), ("samples", 16, 1024)):
        value = view.get(key)
        if not (isinstance(value, int) and low <= value <= high):
            raise ValueError(f"{key} must be a whole number from {low} to {high}")
        out[key] = value
    return out


def to_blender(v: list[float]) -> tuple[float, float, float]:
    """three.js is Y-up and the glTF importer turns Y-up into Blender's Z-up: (x, y, z) becomes (x, -z, y)."""
    return (v[0], -v[2], v[1])


def world_box(obj) -> tuple:
    from mathutils import Vector

    corners = [obj.matrix_world @ Vector(c) for c in obj.bound_box]
    return (
        min(c.x for c in corners),
        min(c.y for c in corners),
        min(c.z for c in corners),
        max(c.x for c in corners),
        max(c.y for c in corners),
        max(c.z for c in corners),
    )


def add_ceiling(camera_at) -> float | None:
    """
    The browser hides the ceiling so the walk camera can look in from above; a photograph from inside needs it, or the
    room is lit by open sky. Put back a matte ceiling at the top of the walls when the camera stands inside them.
    Returns the ceiling height, or None for a view from outside.
    """
    import bpy

    own = [world_box(obj)[2] for obj in bpy.data.objects if obj.get("type") == "ceiling"]
    if own:
        return max(own) if camera_at.z < max(own) else None
    walls = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        x0, y0, z0, x1, y1, z1 = world_box(obj)
        # A wall: taller than 2 m, at least 1 m long, thinner than 0.5 m.
        if z1 - z0 > 2.0 and max(x1 - x0, y1 - y0) > 1.0 and min(x1 - x0, y1 - y0) < 0.5:
            walls.append((x0, y0, z0, x1, y1, z1))
    if len(walls) < 4:
        return None
    tops = sorted(w[5] for w in walls)
    height = tops[len(tops) // 2]
    x0 = min(w[0] for w in walls)
    y0 = min(w[1] for w in walls)
    x1 = max(w[3] for w in walls)
    y1 = max(w[4] for w in walls)
    if not (x0 < camera_at.x < x1 and y0 < camera_at.y < y1 and camera_at.z < height):
        return None
    material = bpy.data.materials.new("ceiling")
    material.use_nodes = True
    shader = material.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = (0.86, 0.85, 0.82, 1)
    shader.inputs["Roughness"].default_value = 0.95
    mesh = bpy.data.meshes.new("ceiling")
    z = height - 0.005
    mesh.from_pydata([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], [], [(0, 3, 2, 1)])
    mesh.materials.append(material)
    bpy.context.scene.collection.objects.link(bpy.data.objects.new("ceiling", mesh))
    return height


def principled(material):
    if not (material.use_nodes and material.node_tree):
        return None
    return next((n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)


def light_fixtures() -> None:
    """
    The model's light fittings are emissive surfaces that only glow in the browser. In a path tracer they are the room's
    lamps: bright fittings emit like an LED panel; dim "glow" surfaces (the browser's trick to keep a ceiling white) stop.
    """
    for material in __import__("bpy").data.materials:
        shader = principled(material)
        if not shader or "Emission Strength" not in shader.inputs:
            continue
        colour_input = shader.inputs.get("Emission Color") or shader.inputs.get("Emission")
        r, g, b = list(colour_input.default_value)[:3]
        luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
        # Blender's default emission is white at strength 0: only surfaces the model made emissive count.
        if colour_input.is_linked or luminance <= 0 or shader.inputs["Emission Strength"].default_value <= 0:
            continue
        if luminance > 0.5:
            # Office LED fittings are about 4000 K: near white. The browser's warm glow colour tints the whole room.
            colour_input.default_value = (1.0, 0.94, 0.86, 1.0)
            # Strong enough that a small downlight disc lights its room like a real 1,000-lumen fitting.
            shader.inputs["Emission Strength"].default_value = 30.0
        else:
            shader.inputs["Emission Strength"].default_value = 0.0


def clear_glass() -> None:
    """Window glass arrives as a blue film at 28% opacity. Real glass is nearly clear and reflects at grazing angles."""
    for material in __import__("bpy").data.materials:
        shader = principled(material)
        if not shader or shader.inputs["Alpha"].is_linked:
            continue
        if shader.inputs["Alpha"].default_value < 0.6 and shader.inputs["Roughness"].default_value < 0.2:
            shader.inputs["Base Color"].default_value = (0.9, 0.95, 0.94, 1)
            shader.inputs["Alpha"].default_value = 0.06
            shader.inputs["Roughness"].default_value = 0.02


def stage(glb: bytes, view: dict) -> dict:
    """Import the model and set up Cycles, daylight, the model's own lamps and the camera, for a still or a bake."""
    import bpy
    from mathutils import Vector

    if glb[:4] != b"glTF":
        raise ValueError("that is not a GLB file")
    if len(glb) > MAX_GLB_BYTES:
        raise ValueError("that model is too large")
    started = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "model.glb")
        with open(path, "wb") as f:
            f.write(glb)
        bpy.ops.import_scene.gltf(filepath=path)
    imported = time.time()

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    prefs = bpy.context.preferences.addons["cycles"].preferences
    device = "CPU"
    for kind in ("OPTIX", "CUDA", "METAL"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            gpus = [dev for dev in prefs.devices if dev.type == kind]
            if gpus:
                for dev in prefs.devices:
                    dev.use = dev.type == kind
                device = kind
                break
        except TypeError:
            continue
    scene.cycles.device = "GPU" if device != "CPU" else "CPU"
    scene.cycles.samples = view["samples"]
    scene.cycles.use_denoising = True
    # OptiX traces, but its denoiser needs a driver library Modal's machines lack ("Failed to create OptiX denoiser").
    scene.cycles.denoiser = "OPENIMAGEDENOISE"
    # An interior is lit mostly by light bouncing off walls and ceiling; four diffuse bounces leave corners too dark.
    scene.cycles.max_bounces = 12
    scene.cycles.diffuse_bounces = 8
    scene.cycles.transparent_max_bounces = 16
    scene.cycles.sample_clamp_indirect = 10
    scene.render.resolution_x = view["width"]
    scene.render.resolution_y = view["height"]
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.0

    camera_at = Vector(to_blender(view["position"]))
    ceiling_z = add_ceiling(camera_at)
    light_fixtures()
    clear_glass()

    # The browser's paper ground is not part of the exported model; the same matte ground goes under it here.
    ground_material = bpy.data.materials.new("ground")
    ground_material.use_nodes = True
    principled = ground_material.node_tree.nodes["Principled BSDF"]
    principled.inputs["Base Color"].default_value = (0.66, 0.61, 0.53, 1)
    principled.inputs["Roughness"].default_value = 1.0
    cx, cy, _ = to_blender(view["target"])
    half = 300.0
    mesh = bpy.data.meshes.new("ground")
    mesh.from_pydata(
        [(cx - half, cy - half, -0.06), (cx + half, cy - half, -0.06), (cx + half, cy + half, -0.06), (cx - half, cy + half, -0.06)],
        [],
        [(0, 1, 2, 3)],
    )
    mesh.materials.append(ground_material)
    ground = bpy.data.objects.new("ground", mesh)
    scene.collection.objects.link(ground)

    # Daylight: a physical sky, and a sun from the same direction the browser's sun comes from.
    world = bpy.data.worlds.new("sky")
    scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    background = nodes["Background"]
    sky = nodes.new("ShaderNodeTexSky")
    # Blender 4.2 calls the physical sky NISHITA; 5.x renamed it MULTIPLE_SCATTERING.
    try:
        sky.sky_type = "NISHITA"
    except TypeError:
        sky.sky_type = "MULTIPLE_SCATTERING"
    # The sun lamp below is the sun; the sky's own disc would light the scene a second time, far brighter.
    sky.sun_disc = False
    to_sun = Vector(to_blender(view["sun"])).normalized()
    sky.sun_elevation = max(0.05, math.asin(max(-1.0, min(1.0, to_sun.z))))
    sky.sun_rotation = math.atan2(to_sun.x, to_sun.y)
    world.node_tree.links.new(sky.outputs["Color"], background.inputs["Color"])
    background.inputs["Strength"].default_value = 0.4

    sun_data = bpy.data.lights.new("sun", "SUN")
    sun_data.energy = 2.6
    sun_data.angle = math.radians(1.5)
    sun_data.color = (1.0, 0.97, 0.92)
    sun = bpy.data.objects.new("sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()

    camera_data = bpy.data.cameras.new("view")
    camera_data.sensor_fit = "VERTICAL"
    camera_data.clip_start = 0.05
    camera_data.clip_end = 1000
    camera = bpy.data.objects.new("view", camera_data)
    scene.collection.objects.link(camera)
    camera.location = camera_at
    look = Vector(to_blender(view["target"])) - camera_at
    camera.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
    camera_data.angle_y = math.radians(view["fov"])
    scene.camera = camera

    return {"scene": scene, "device": device, "ceiling": ceiling_z, "importMs": round((imported - started) * 1000)}


# What the bake lights: the building's own surfaces, each carrying light-map coordinates (TEXCOORD_1) and a texture size
# (extras.lightmap) set by the browser. Furniture keeps its materials and is lit live in the browser.
BAKED_TYPES = ("floor", "wall", "ceiling", "door", "frame")
# Stored light is scaled by 1 / LIGHT_RANGE so bright pools near lamps and windows still fit in 8 bits; the browser
# multiplies it back.
LIGHT_RANGE = 4.0


def denoiser():
    """
    A small scene whose compositor runs Intel Open Image Denoise on one image: the same denoiser Cycles uses for
    renders, which bakes do not get on their own. Blender 4.2 keeps the compositor on the scene; 5.x on a node group.
    Returns a function from a (side, side, 3) float array to its denoised copy.
    """
    import bpy
    import numpy

    scene = bpy.data.scenes.new("denoise")
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 1
    scene.cycles.device = "CPU"
    scene.camera = bpy.data.objects.new("denoise-camera", bpy.data.cameras.new("denoise-camera"))
    scene.collection.objects.link(scene.camera)
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    scene.view_settings.view_transform = "Standard"
    if hasattr(scene, "compositing_node_group"):
        tree = bpy.data.node_groups.new("denoise", "CompositorNodeTree")
        tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        scene.compositing_node_group = tree
        output = tree.nodes.new("NodeGroupOutput")
    else:
        scene.use_nodes = True
        tree = scene.node_tree
        tree.nodes.clear()
        output = tree.nodes.new("CompositorNodeComposite")
    source = tree.nodes.new("CompositorNodeImage")
    clean = tree.nodes.new("CompositorNodeDenoise")
    tree.links.new(source.outputs["Image"], clean.inputs["Image"])
    tree.links.new(clean.outputs["Image"], output.inputs[0])

    def run(rgb, folder: str):
        side = rgb.shape[0]
        image = bpy.data.images.new("noisy", side, side, float_buffer=True)
        rgba = numpy.concatenate([rgb, numpy.ones((side, side, 1), dtype=numpy.float32)], axis=2)
        image.pixels.foreach_set(rgba.astype(numpy.float32).ravel())
        source.image = image
        scene.render.resolution_x = side
        scene.render.resolution_y = side
        path = os.path.join(folder, "clean.exr")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True, scene=scene.name)
        done = bpy.data.images.load(path)
        out = numpy.empty(side * side * 4, dtype=numpy.float32)
        done.pixels.foreach_get(out)
        bpy.data.images.remove(done)
        bpy.data.images.remove(image)
        return out.reshape(side, side, 4)[:, :, :3]

    return run


def bake(glb: bytes, view: dict) -> dict:
    """
    Path-trace the light falling on every floor, wall, ceiling, door and frame into a light map, so the browser can walk
    through the building with that light in real time. Only diffuse light is baked, not colour: the browser keeps each
    surface's own sharp texture and multiplies the light in. Returns one JPEG per scene node id.
    """
    import bpy
    import numpy

    started = time.time()
    staged = stage(glb, view)
    scene = staged["scene"]
    scene.cycles.use_denoising = False
    # A light map has no denoiser: clamping indirect light removes the bright specks that would read as grime.
    scene.cycles.sample_clamp_indirect = 4.0

    targets = []
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.data.objects:
        if obj.type != "MESH" or obj.get("type") not in BAKED_TYPES or not obj.get("nodeId") or not obj.get("lightmap"):
            continue
        if len(obj.data.uv_layers) < 2:
            continue
        side = int(obj["lightmap"])
        if not 16 <= side <= 2048:
            continue
        obj.data.uv_layers.active = obj.data.uv_layers[1]
        image = bpy.data.images.new(f"light-{obj['nodeId']}", side, side, float_buffer=True)
        for slot in obj.material_slots:
            # Each surface bakes into its own image, so each needs its own copy of a shared material.
            material = slot.material.copy() if slot.material else bpy.data.materials.new("plain")
            material.use_nodes = True
            node = material.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = image
            material.node_tree.nodes.active = node
            slot.material = material
        obj.select_set(True)
        targets.append((obj, image))
    if not targets:
        raise ValueError("the model has no surfaces prepared for light")
    bpy.context.view_layer.objects.active = targets[0][0]
    scene.render.bake.margin = 4
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"})
    baked = time.time()

    # Exposure from the light itself: the geometric mean of every lit texel becomes 1, so a surface shows its own colour
    # under typical light. The browser then adapts from room to room like an eye. (Metering with a second render first
    # crashed Blender 4.2.)
    lights = {}
    logs = []
    for obj, image in targets:
        side = image.size[0]
        pixels = numpy.empty(side * side * 4, dtype=numpy.float32)
        image.pixels.foreach_get(pixels)
        rgb = pixels.reshape(side, side, 4)[:, :, :3]
        lights[obj.name] = rgb
        luminance = rgb @ numpy.array([0.2126, 0.7152, 0.0722], dtype=numpy.float32)
        logs.append(numpy.log(luminance[luminance > 1e-4]))
    exposure = -float(numpy.mean(numpy.concatenate(logs))) / math.log(2)
    surfaces = {}
    scale = (2.0**exposure) / LIGHT_RANGE
    clean = denoiser()
    folder = tempfile.mkdtemp()
    for obj, image in targets:
        side = image.size[0]
        rgb = clean(lights[obj.name], folder).reshape(-1, 3) * scale
        rgb = numpy.clip(rgb, 0.0, 1.0)
        encoded = numpy.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * numpy.power(rgb, 1 / 2.4) - 0.055)
        out = bpy.data.images.new(f"out-{obj['nodeId']}", side, side)
        out.colorspace_settings.name = "Non-Color"
        rgba = numpy.concatenate([encoded, numpy.ones((encoded.shape[0], 1), dtype=numpy.float32)], axis=1)
        out.pixels.foreach_set(rgba.astype(numpy.float32).ravel())
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "light.jpg")
            out.filepath_raw = path
            out.file_format = "JPEG"
            scene.render.image_settings.quality = 88
            out.save()
            with open(path, "rb") as f:
                surfaces[str(obj["nodeId"])] = base64.b64encode(f.read()).decode("ascii")
    return {
        "lightmaps": surfaces,
        "range": LIGHT_RANGE,
        "device": staged["device"],
        "samples": scene.cycles.samples,
        "exposure": round(exposure, 2),
        "importMs": staged["importMs"],
        "bakeMs": round((baked - started) * 1000) - staged["importMs"],
        "denoiseMs": round((time.time() - baked) * 1000),
    }

with image.imports():
    from fastapi import HTTPException, Request


@app.function(
    image=image,
    # The first GPU type with capacity: L4s ran out on 2 Nov 2026 and a render waited over 400 s for one.
    gpu=["L4", "A10G", "L40S"],
    secrets=[modal.Secret.from_name("icarus-render")],
    # A whole-building light bake takes a few minutes on one GPU.
    timeout=600,
    max_containers=2,
    scaledown_window=120,
)
@modal.fastapi_endpoint(method="POST")
async def draw(request: Request):
    token = os.environ.get("RENDER_WORKER_TOKEN", "")
    given = request.headers.get("authorization", "").removeprefix("Bearer ")
    if not token or not hmac.compare_digest(given.encode(), token.encode()):
        raise HTTPException(status_code=401, detail="unauthorised")
    try:
        view = parse_view(request.headers.get("x-icarus-view", ""))
        glb = await request.body()
        # Blender segfaults when it resets for a second job and took the whole container with it, so every click was a
        # cold start (3 Nov 2026). Each render runs in a fresh child; a crash ends only that child.
        import asyncio
        import multiprocessing

        with multiprocessing.get_context("spawn").Pool(1) as pool:
            return await asyncio.to_thread(pool.apply, bake, (glb, view))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
