"""
Renders one view of an Icarus model with Blender Cycles on a Modal GPU, for "Make it real".

The browser exports the model it is showing (a GLB, the same file "Export for Blender" gives) and the camera it is
looking through; this worker imports that file, places the same camera, lights it with a sky and a sun, and path
traces it on the GPU. It owns no scene state and adds nothing to the model: what it draws is what the browser drew.

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
            shader.inputs["Emission Strength"].default_value = 12.0
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


def metered_exposure(scene, folder: str) -> float:
    """
    Meter the view like a camera: a quick small render, then the exposure that puts the scene's log-average luminance
    at mid grey, ignoring the brightest 3% (windows, lamps). Clamped so an odd frame cannot blow out or go black.
    """
    import bpy
    import numpy

    settings = scene.render
    keep = (settings.resolution_percentage, scene.cycles.samples, scene.cycles.use_denoising)
    settings.resolution_percentage = 25
    scene.cycles.samples = 16
    scene.cycles.use_denoising = False
    path = os.path.join(folder, "meter.exr")
    settings.image_settings.file_format = "OPEN_EXR"
    settings.filepath = path
    bpy.ops.render.render(write_still=True)
    settings.resolution_percentage, scene.cycles.samples, scene.cycles.use_denoising = keep
    image = bpy.data.images.load(path)
    pixels = numpy.empty(len(image.pixels), dtype=numpy.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    rgb = pixels.reshape(-1, 4)[:, :3]
    luminance = rgb @ numpy.array([0.2126, 0.7152, 0.0722], dtype=numpy.float32)
    luminance = numpy.sort(luminance)[: max(1, int(len(luminance) * 0.97))]
    average = float(numpy.exp(numpy.mean(numpy.log(luminance + 1e-4))))
    return max(-4.0, min(4.0, math.log2(0.18 / average)))


def render(glb: bytes, view: dict) -> dict:
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
    pitch = math.atan2(look.z, math.hypot(look.x, look.y))
    fov = math.radians(view["fov"])
    if ceiling_z is not None and abs(pitch) < math.radians(35):
        # An architectural photograph: the camera stays level so walls stay vertical, and the lens shifts to keep the
        # same point at the same height in the frame. Wider than 60 degrees stretches the foreground like a fisheye.
        fov = min(fov, math.radians(60))
        level = Vector((look.x, look.y, 0.0))
        camera.rotation_euler = level.to_track_quat("-Z", "Y").to_euler()
        rise = math.tan(pitch) / (2 * math.tan(fov / 2))
        camera_data.shift_y = max(-0.3, min(0.3, rise)) * view["height"] / max(view["width"], view["height"])
    else:
        camera.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
    camera_data.angle_y = fov
    scene.camera = camera

    with tempfile.TemporaryDirectory() as d:
        scene.view_settings.exposure = metered_exposure(scene, d)
        out = os.path.join(d, "view.jpg")
        scene.render.image_settings.file_format = "JPEG"
        scene.render.image_settings.quality = 90
        scene.render.filepath = out
        bpy.ops.render.render(write_still=True)
        with open(out, "rb") as f:
            jpeg = f.read()
    done = time.time()
    return {
        "jpegBase64": base64.b64encode(jpeg).decode("ascii"),
        "device": device,
        "samples": view["samples"],
        "exposure": round(scene.view_settings.exposure, 2),
        "ceiling": ceiling_z is not None,
        "importMs": round((imported - started) * 1000),
        "renderMs": round((done - imported) * 1000),
    }


with image.imports():
    from fastapi import HTTPException, Request


@app.function(
    image=image,
    # The first GPU type with capacity: L4s ran out on 2 Nov 2026 and a render waited over 400 s for one.
    gpu=["L4", "A10G", "L40S"],
    secrets=[modal.Secret.from_name("icarus-render")],
    timeout=300,
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
            return await asyncio.to_thread(pool.apply, render, (glb, view))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
