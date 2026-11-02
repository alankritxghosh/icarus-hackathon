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
    for kind in ("OPTIX", "CUDA"):
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
    scene.cycles.max_bounces = 6
    scene.render.resolution_x = view["width"]
    scene.render.resolution_y = view["height"]
    scene.render.resolution_percentage = 100
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -1.1

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
    sky.sky_type = "NISHITA"
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
    sun_data.color = (1.0, 0.93, 0.84)
    sun = bpy.data.objects.new("sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()

    camera_data = bpy.data.cameras.new("view")
    camera_data.sensor_fit = "VERTICAL"
    camera_data.angle_y = math.radians(view["fov"])
    camera_data.clip_start = 0.05
    camera_data.clip_end = 1000
    camera = bpy.data.objects.new("view", camera_data)
    scene.collection.objects.link(camera)
    camera.location = to_blender(view["position"])
    look = Vector(to_blender(view["target"])) - camera.location
    camera.rotation_euler = look.to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera

    with tempfile.TemporaryDirectory() as d:
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
        return render(await request.body(), view)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
