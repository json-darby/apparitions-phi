"""
Filler cast portraits, AI-generated locally (free, open weights, CPU), until the
owner's Gemini portraits exist. Every person is original and fictional; no real
person's name or photo is used in any prompt (see CAST_SHEET.md).

Model: segmind/SSD-1B (Apache-2.0; text encoders + VAE) with the latent-consistency
distilled UNet latent-consistency/lcm-ssd-1b (CreativeML OpenRAIL++-M), 4 steps.
Weights cache in pipeline/work/models/ (git-ignored).

Each person: a neutral portrait from a fixed seed, then the other expressions by
image-to-image from that neutral (same seed, moderate strength) so the face, hair,
clothes and framing stay put and the dots can morph between them.

    python pipeline/gen_cast.py                 # all people, all expressions
    python pipeline/gen_cast.py --who nok ton   # some people
Output: pipeline/work/filler/src/people/<who>/<expression>.png  + gen_log.json
"""

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.environ.setdefault("HF_HOME", str(HERE / "work" / "models" / "hf"))
OUT = HERE / "work" / "filler" / "src" / "people"

LOOK = "pure black background, low-key warm night light from the left, photorealistic"
NEG = (
    "text, watermark, logo, hands, hat brim over eyes, sunglasses over eyes, cartoon, illustration, painting, "
    "3d render, deformed, extra limbs, blurry, child, teenager, celebrity, bright background, studio backdrop colour"
)
EXPR = {
    "neutral": "neutral expression, mouth closed",
    "smile": "warm natural smile",
    "sad": "sad, brows raised inside, gaze lowered",
    "closed": "eyes closed, eyelids shut, relaxed face",
    "puzzled": "puzzled, one eyebrow raised",
}
STRENGTH = {"smile": 0.55, "sad": 0.5, "closed": 0.45, "puzzled": 0.55}

# descriptions from pipeline/CAST_SHEET.md (shortened to fit the text encoder)
CAST = {
    "nok": ("woman, 55", "round face, laugh lines, short black hair greying, navy t-shirt, striped apron", 1101),
    "ton": ("man, 45", "broad calm face, short black hair, sunglasses on top of head, light blue polo shirt, stubble", 2203),
    "ploy": ("woman, 25", "oval face, hair in a neat low bun, pearl earrings, navy uniform jacket", 3307),
    "lek": ("man, 32", "lean face, teasing eyes, plain dark cap, faded grey t-shirt", 4409),
    "mai": ("woman, 35", "calm face, long straight black hair, white pharmacist coat", 5501),
    "bank": ("man, 28", "friendly face, short textured hair, dark open-collar shirt", 6607),
    "fah": ("woman, 28", "short black bob with fringe, direct gaze, black t-shirt, silver hoops", 7703),
    "pim": ("woman, 35", "relaxed face, shoulder-length black hair behind one ear, off-white linen shirt", 8803),
}


def prompt_for(who: str, expr: str) -> str:
    kind, desc, _ = CAST[who]
    return f"head and shoulders photo of a fictional Thai {kind} from Bangkok, Southeast Asian features, warm brown skin, {desc}, facing camera, {EXPR[expr]}, {LOOK}"


def main(argv=None):
    """Three stages so the peak memory stays near the UNet's own size (this PC has
    little free virtual memory): 1 text encoders -> embeddings, freed; 2 UNet ->
    latents (neutral by text-to-image, the other expressions by image-to-image from
    the neutral's latents), freed; 3 VAE -> pixels. LCM runs without CFG (guidance 1),
    so the negative prompt is not used."""
    import gc

    import torch
    from diffusers import AutoencoderKL, LCMScheduler, StableDiffusionXLImg2ImgPipeline, StableDiffusionXLPipeline, UNet2DConditionModel

    ap = argparse.ArgumentParser()
    ap.add_argument("--who", nargs="*", default=list(CAST))
    ap.add_argument("--expr", nargs="*", default=list(EXPR))
    ap.add_argument("--size", type=int, default=832)
    ap.add_argument("--steps", type=int, default=4)
    ap.add_argument("--seed-offset", type=int, default=0)
    ap.add_argument("--strength", nargs="*", default=[], help="expr=value overrides, e.g. closed=0.7")
    ap.add_argument("--tag", default="", help="suffix for output files (trials)")
    a = ap.parse_args(argv)
    for kv in a.strength:
        k, v = kv.split("=")
        STRENGTH[k] = float(v)
    torch.set_num_threads(int(os.environ.get("PHI_THREADS", "6")))  # modest: other jobs share this PC
    f32 = torch.float32
    jobs = [(w, e) for w in a.who for e in (["neutral"] + [x for x in a.expr if x != "neutral"])]

    # 1 text
    te = StableDiffusionXLPipeline.from_pretrained("segmind/SSD-1B", unet=None, vae=None, variant="fp16", torch_dtype=f32)
    emb = {}
    with torch.inference_mode():
        for w, e in jobs:
            pe, _, pooled, _ = te.encode_prompt(prompt_for(w, e), device="cpu", num_images_per_prompt=1, do_classifier_free_guidance=False)
            emb[(w, e)] = (pe, pooled)
    del te
    gc.collect()
    print("  prompts encoded", flush=True)

    # 2 UNet
    unet = UNet2DConditionModel.from_pretrained("latent-consistency/lcm-ssd-1b", variant="fp16", torch_dtype=f32)
    sched = LCMScheduler.from_pretrained("segmind/SSD-1B", subfolder="scheduler")
    t2i = StableDiffusionXLPipeline(vae=AutoencoderKL.from_config(AutoencoderKL.load_config("segmind/SSD-1B", subfolder="vae")), text_encoder=None, text_encoder_2=None, tokenizer=None, tokenizer_2=None, unet=unet, scheduler=sched)
    t2i.set_progress_bar_config(disable=True)
    i2i = StableDiffusionXLImg2ImgPipeline(**t2i.components)
    i2i.set_progress_bar_config(disable=True)
    lat = {}
    with torch.inference_mode():
        for w, e in jobs:
            seed = CAST[w][2] + a.seed_offset
            g = torch.Generator().manual_seed(seed)
            pe, pooled = emb[(w, e)]
            t0 = time.time()
            if e == "neutral":
                lat[(w, e)] = t2i(prompt_embeds=pe, pooled_prompt_embeds=pooled, num_inference_steps=a.steps, guidance_scale=1.0, width=a.size, height=a.size, generator=g, output_type="latent").images
            else:
                n = lat[(w, "neutral")]
                lat[(w, e)] = i2i(prompt_embeds=pe, pooled_prompt_embeds=pooled, image=n, strength=STRENGTH[e], num_inference_steps=max(a.steps, round(a.steps / STRENGTH[e])), guidance_scale=1.0, generator=g, output_type="latent").images
            print(f"  {w}/{e} latent {time.time() - t0:.0f}s", flush=True)
    del t2i, i2i, unet
    gc.collect()

    # 3 VAE
    vae = AutoencoderKL.from_pretrained("segmind/SSD-1B", subfolder="vae", variant="fp16", torch_dtype=f32)
    vae.enable_tiling()
    from diffusers.image_processor import VaeImageProcessor

    proc = VaeImageProcessor(vae_scale_factor=8)
    logp = OUT / "gen_log.json"
    log = json.loads(logp.read_text(encoding="utf8")) if logp.exists() else {}
    with torch.inference_mode():
        for (w, e), z in lat.items():
            x = vae.decode(z / vae.config.scaling_factor).sample
            im = proc.postprocess(x, output_type="pil")[0]
            (OUT / w).mkdir(parents=True, exist_ok=True)
            im.save(OUT / w / f"{e}{a.tag}.png")
            log[f"{w}/{e}{a.tag}"] = {"prompt": prompt_for(w, e), "seed": CAST[w][2] + a.seed_offset, "steps": a.steps, "size": a.size, "mode": "text-to-image" if e == "neutral" else f"image-to-image from the neutral latents, strength {STRENGTH[e]}", "model": "segmind/SSD-1B (Apache-2.0) + latent-consistency/lcm-ssd-1b (OpenRAIL++-M)"}
            print(f"  {w}/{e} saved", flush=True)
    logp.write_text(json.dumps(log, indent=1), encoding="utf8")


if __name__ == "__main__":
    main()
