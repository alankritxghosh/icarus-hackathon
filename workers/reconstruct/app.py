"""
Single-photo geometry on Modal: a metric 3D point cloud and the camera field of view.

This worker only measures. It owns no scene state and knows nothing about offices: it returns
numbers, and the TypeScript side (packages/core) decides what they mean. Weights are cached in a
Volume so a cold start does not download them again.
"""

import base64
import json
import math
import time

import modal

MOGE_COMMIT = "74fbce054ebed49800de42d0ad0e83495065719a"
MODEL = "Ruicheng/moge-2-vitl-normal"  # MIT licence, not gated

app = modal.App("icarus-reconstruct")
weights = modal.Volume.from_name("icarus-weights", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.7.1",
        "torchvision==0.22.1",
        "numpy",
        "scipy",
        "opencv-python-headless",
        "pillow",
        "huggingface-hub",
        "click",
        "tqdm",
        "trimesh",
        "matplotlib",
    )
    .pip_install(
        "utils3d_moge @ git+https://github.com/EasternJournalist/utils3d-moge.git@62f09d58509485564e24d5d9f6aac9ee9ebc0c37"
    )
    .run_commands(f"pip install --no-deps git+https://github.com/microsoft/MoGe.git@{MOGE_COMMIT}")
    .env({"HF_HOME": "/models/hf"})
)


def b64(array) -> str:
    return base64.b64encode(array.tobytes()).decode("ascii")


@app.cls(
    gpu="L4",
    image=image,
    volumes={"/models": weights},
    timeout=300,
    scaledown_window=60,
    max_containers=1,
)
class Geometry:
    @modal.enter()
    def load(self):
        import torch
        from moge.model.v2 import MoGeModel

        self.torch = torch
        self.device = torch.device("cuda")
        self.model = MoGeModel.from_pretrained(MODEL).to(self.device).eval()
        weights.commit()

    @modal.method()
    def estimate(self, image_bytes: bytes, max_points: int = 40000) -> dict:
        import cv2
        import numpy as np

        started = time.time()
        bgr = cv2.imdecode(np.frombuffer(image_bytes, np.uint8), cv2.IMREAD_COLOR)
        if bgr is None:
            raise ValueError("the image could not be decoded")
        height, width = bgr.shape[:2]
        scale = min(1.0, 1280 / max(height, width))
        if scale < 1.0:
            bgr = cv2.resize(bgr, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
            height, width = bgr.shape[:2]
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        tensor = self.torch.tensor(rgb / 255, dtype=self.torch.float32, device=self.device).permute(2, 0, 1)
        with self.torch.no_grad():
            out = self.model.infer(tensor)

        points = out["points"].cpu().numpy()
        mask = out["mask"].cpu().numpy().astype(bool)
        normals = out["normal"].cpu().numpy() if "normal" in out else None
        k = out["intrinsics"].cpu().numpy()
        valid = np.argwhere(mask & np.isfinite(points).all(axis=-1))
        rng = np.random.default_rng(0)
        if len(valid) > max_points:
            valid = valid[rng.choice(len(valid), max_points, replace=False)]
        ys, xs = valid[:, 0], valid[:, 1]
        pts = points[ys, xs].astype(np.float32)
        depth = pts[:, 2]
        result = {
            "version": 1,
            "model": MODEL,
            "moge_commit": MOGE_COMMIT,
            "gpu": self.torch.cuda.get_device_name(0),
            "width": int(width),
            "height": int(height),
            "intrinsics": k.tolist(),
            "fov_x_deg": float(math.degrees(2 * math.atan(0.5 / float(k[0, 0])))),
            "count": int(len(pts)),
            "points": b64(pts),
            "colors": b64(rgb[ys, xs].astype(np.uint8)),
            "uv": b64(np.stack([xs, ys], axis=1).astype(np.uint16)),
            "depth_m": {p: float(np.percentile(depth, p)) for p in (1, 25, 50, 75, 99)},
            "seconds": round(time.time() - started, 2),
        }
        if normals is not None:
            result["normals"] = b64(normals[ys, xs].astype(np.float16))
        return result


@app.local_entrypoint()
def main(image: str, out: str = "geometry.json"):
    with open(image, "rb") as f:
        data = f.read()
    result = Geometry().estimate.remote(data)
    with open(out, "w") as f:
        json.dump(result, f)
    summary = {k: v for k, v in result.items() if k not in ("points", "colors", "uv", "normals")}
    print(json.dumps(summary, indent=2))
