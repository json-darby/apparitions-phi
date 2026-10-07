"""Pack the whole street for The Street screen, without the perspective pre-warp.

`pack_portraits.py still --kind scenes` pre-warps a scene for the catalogue's 3D
camera, which on a wide panorama pulls the near road and the taxi inward and
leaves masked gaps at the edges. The Street draws its own flat parallax, so the
street is packed straight: the same tone curve and the same depth model and
checks as every scene, the full frame kept (alpha 1 everywhere).

    python pack_street.py [--src generated/street-one/street-final.png] [--size 2048x869]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

import phi_depth as P
from pack_portraits import DEFAULT_OUT, load_manifest, save_manifest, save_pair, CREDIT_DAV2

ROOT = Path(__file__).resolve().parent.parent


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(ROOT / "generated" / "street-one" / "street-final.png"))
    ap.add_argument("--size", default="2048x869")
    a = ap.parse_args()
    ow, oh = [int(v) for v in a.size.split("x")]
    cv2 = P._cv2()
    eng = P.Engine()
    rgb0 = P.load_rgb(a.src)
    W = 2048
    rgb = np.clip(cv2.resize(rgb0, (W, round(W * rgb0.shape[0] / rgb0.shape[1])), interpolation=cv2.INTER_AREA), 0, 1)
    ratio, rep = None, None
    for model in eng.models():
        ratio, rep = P.scene_depth(rgb, model, "scenes/street", 0.5, 2.5)
        print("   ", rep.line())
        if rep.ok and ratio is not None:
            break
        ratio = None
    if ratio is None:
        raise SystemExit("street depth rejected")
    q, K = 2.5, 0.5
    d01 = np.clip(ratio / q, 0, 1).astype(np.float32)
    grey = P.tone(P.luma(rgb), np.ones(rgb.shape[:2], np.float32), 2, 50, 99.7, 0.17, 1.0)
    ar = lambda x: cv2.resize(x.astype(np.float32), (ow, oh), interpolation=cv2.INTER_AREA)
    rgba, dimg = P.to_images(ar(grey), np.ones((oh, ow), np.float32), ar(d01))
    out = Path(DEFAULT_OUT)
    save_pair(rgba, dimg, out / "scenes" / "street", lossless_depth=True)
    m = load_manifest(out)
    m["scenes"]["street"] = {"image": "scenes/street.webp", "depth": "scenes/street.depth.webp", "credit": CREDIT_DAV2,
                             "size": [ow, oh], "depth_map": {"offset": round(1 / q, 5), "scale": round(K * q, 5)}}
    save_manifest(out, m)
    print(json.dumps(m["scenes"]["street"]))


if __name__ == "__main__":
    main()
