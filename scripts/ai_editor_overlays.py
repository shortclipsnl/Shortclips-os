#!/usr/bin/env python3
"""
Rendert de grafische lagen van de Shortclips AI Editor als transparante PNG's:
ondertitelblokken en UI-kaarten (checklist, statuslijst, proces, statistiek,
CTA-formulier) in de Shortclips Ads Style.

Aanroep:  ai_editor_overlays.py <spec.json> <out_dir>

spec = {
  "width": 1080, "height": 1920, "fontDir": "...",
  "captions": [ {"id": "c1", "text": "..."} ],
  "cards": [ {"id": "k1", "template": "checklist", "title": "...", "items": [{"text": "...", "pill": "...", "pillTone": "primary"}],
              "value": "50+", "label": "merken", "sublabel": "...", "button": "..."} ],
  "style": { "captions": {...}, "cards": {...} },
  "captionScale": 1.0, "captionOffsetY": 0
}

Schrijft <out_dir>/manifest.json met per laag het bestand en de positie.
Alles wordt op 2x gerenderd en verkleind voor scherpe randen.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

SS = 2  # supersampling
K = SS  # SS x schaal (preview = halve resolutie); gezet in main()


def hex_rgb(h, a=255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


class Fonts:
    def __init__(self, font_dir):
        self.dir = font_dir
        self.cache = {}

    def get(self, name, size):
        key = (name, size)
        if key not in self.cache:
            files = {
                "Poppins-Bold": "Poppins-Bold.ttf",
                "Inter-Bold": "Inter-Bold.otf",
                "Inter-SemiBold": "Inter-SemiBold.otf",
            }
            self.cache[key] = ImageFont.truetype(os.path.join(self.dir, files.get(name, "Poppins-Bold.ttf")), int(round(size)))
        return self.cache[key]


def downsample(img):
    return img.resize((img.width // SS, img.height // SS), Image.LANCZOS)


def with_shadow(card, radius, blur=18, alpha=60, offset=8):
    """Zachte schaduw onder een kaart (op SS-schaal)."""
    pad = blur * 3
    w, h = card.size
    pad = int(pad)
    canvas = Image.new("RGBA", (w + pad * 2, h + pad * 2), (0, 0, 0, 0))
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=int(round(radius)), fill=alpha)
    shadow = Image.new("RGBA", (w, h), (2, 0, 32, 255))
    shadow.putalpha(mask)
    canvas.alpha_composite(shadow, (pad, pad + offset))
    canvas = canvas.filter(ImageFilter.GaussianBlur(blur))
    canvas.alpha_composite(card, (pad, pad))
    return canvas, pad


def render_caption(text, st, fonts, scale):
    size = int(round(st["sizePx"] * scale)) * SS
    font = fonts.get(st.get("font", "Poppins-Bold"), size)
    pad_x = int(round(st["paddingXPx"] * scale)) * SS
    box_h = int(round(st["boxHeightPx"] * scale)) * SS
    tw = font.getlength(text)
    w = int(tw + pad_x * 2)
    img = Image.new("RGBA", (w, box_h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, w - 1, box_h - 1), radius=int(st["boxRadiusPx"] * scale) * SS, fill=hex_rgb(st["boxColor"]))
    # Optisch centreren op de x-hoogte (Poppins heeft ruime ascenders).
    d.text((w / 2, box_h / 2 + size * 0.04), text, font=font, fill=hex_rgb(st["textColor"]), anchor="mm")
    return downsample(img)


def text_fit(draw, text, font, max_w):
    if font.getlength(text) <= max_w:
        return text
    while text and font.getlength(text + "…") > max_w:
        text = text[:-1]
    return text.rstrip() + "…"


def check_circle(d, cx, cy, r, filled, st):
    if filled:
        d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=hex_rgb(st["pillPrimary"]))
        w = max(3, r // 4)
        d.line([(cx - r * 0.45, cy + r * 0.02), (cx - r * 0.1, cy + r * 0.38), (cx + r * 0.5, cy - r * 0.35)], fill=(255, 255, 255, 255), width=int(round(w)), joint="curve")
    else:
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=(208, 214, 226, 255), width=int(round(max(3, r // 6))))


def pill(d, x_right, cy, text, tone, st, font):
    pad = 20 * K
    h = 46 * K
    w = int(font.getlength(text) + pad * 2)
    color = hex_rgb(st["pillPrimary"] if tone != "secondary" else st["pillSecondary"])
    d.rounded_rectangle((x_right - w, cy - h / 2, x_right, cy + h / 2), radius=int(round(h // 2)), fill=color)
    d.text((x_right - w / 2, cy), text, font=font, fill=(255, 255, 255, 255), anchor="mm")


def card_base(width, height, st):
    width, height = int(round(width)), int(round(height))
    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((0, 0, width - 1, height - 1), radius=int(round(st["radiusPx"] * K)), fill=hex_rgb(st["cardBg"]))
    return img, d


def render_list_card(card, state, st, fonts):
    """checklist en status_list: titel + rijen; state = aantal zichtbare rijen."""
    W = int(round(st["widthPx"] * K))
    pad = 36 * K
    title_f = fonts.get("Inter-Bold", 36 * K)
    row_f = fonts.get("Inter-Bold", 33 * K)
    pill_f = fonts.get("Inter-Bold", 25 * K)
    row_h = 74 * K
    items = card.get("items", [])
    has_title = bool(card.get("title"))
    title_h = 66 * K if has_title else 0
    H = pad * 2 + title_h + row_h * max(1, len(items)) - (8 * K)
    img, d = card_base(W, H, st)
    navy = hex_rgb(st["textColor"])
    y = pad
    if has_title:
        d.text((pad, y + 20 * K), text_fit(d, card["title"], title_f, W - pad * 2), font=title_f, fill=navy, anchor="lm")
        y += title_h
    for i, it in enumerate(items):
        cy = y + row_h * i + row_h / 2 - 6 * K
        visible = i < state
        if card["template"] == "checklist":
            if not visible:
                continue
            check_circle(d, W - pad - 22 * K, cy, 22 * K, True, st)
            d.text((pad, cy), text_fit(d, it["text"], row_f, W - pad * 2 - 70 * K), font=row_f, fill=navy, anchor="lm")
        else:  # status_list
            if not visible:
                continue
            d.text((pad, cy), text_fit(d, it["text"], row_f, W * 0.55), font=row_f, fill=navy, anchor="lm")
            if it.get("pill"):
                pill(d, W - pad, cy, it["pill"], it.get("pillTone", "primary"), st, pill_f)
    return img


def render_process(card, state, st, fonts):
    W = int(round(st["widthPx"] * K))
    pad = 34 * K
    items = card.get("items", [])[:6]
    n = max(1, len(items))
    title_f = fonts.get("Inter-Bold", 32 * K)
    lab_f = fonts.get("Inter-SemiBold", 21 * K)
    has_title = bool(card.get("title"))
    H = pad * 2 + (60 * K if has_title else 0) + 130 * K
    img, d = card_base(W, H, st)
    navy = hex_rgb(st["textColor"])
    y = pad
    if has_title:
        d.text((pad, y + 18 * K), text_fit(d, card["title"], title_f, W - pad * 2), font=title_f, fill=navy, anchor="lm")
        y += 60 * K
    cy = y + 40 * K
    xs = [pad + 30 * K + (W - pad * 2 - 60 * K) * (i / max(1, n - 1)) for i in range(n)] if n > 1 else [W / 2]
    r = 26 * K
    for i in range(n - 1):
        done = i + 1 < state
        d.line([(xs[i] + r, cy), (xs[i + 1] - r, cy)], fill=hex_rgb(st["pillPrimary"]) if done else (214, 220, 232, 255), width=int(round(6 * K)))
    for i, it in enumerate(items):
        done = i < state
        if done:
            d.ellipse((xs[i] - r, cy - r, xs[i] + r, cy + r), fill=hex_rgb(st["pillPrimary"]))
            check_circle(d, xs[i], cy, r, True, st)
        else:
            d.ellipse((xs[i] - r, cy - r, xs[i] + r, cy + r), fill=(255, 255, 255, 255), outline=(208, 214, 226, 255), width=int(round(4 * K)))
        label = text_fit(d, it["text"], lab_f, (W - pad * 2) / n + 10 * K)
        d.text((xs[i], cy + r + 26 * K), label, font=lab_f, fill=navy if done else (130, 136, 156, 255), anchor="mm")
    return img


def render_cta(card, state, st, fonts):
    W = int(round(st["widthPx"] * K))
    pad = 34 * K
    title_f = fonts.get("Inter-Bold", 34 * K)
    field_f = fonts.get("Inter-SemiBold", 26 * K)
    btn_f = fonts.get("Inter-Bold", 27 * K)
    H = pad * 2 + 60 * K + 2 * 74 * K + 86 * K
    img, d = card_base(W, H, st)
    navy = hex_rgb(st["textColor"])
    y = pad
    d.text((pad, y + 18 * K), text_fit(d, card.get("title") or "", title_f, W - pad * 2), font=title_f, fill=navy, anchor="lm")
    y += 60 * K
    for label in ("Naam", "Telefoon"):
        d.rounded_rectangle((pad, y, W - pad, y + 58 * K), radius=int(round(12 * K)), fill=(241, 243, 248, 255))
        d.text((pad + 22 * K, y + 29 * K), label, font=field_f, fill=(150, 156, 176, 255), anchor="lm")
        y += 74 * K
    y += 6 * K
    bh = 66 * K
    d.rounded_rectangle((pad, y, W - pad, y + bh), radius=int(round(bh // 2)), fill=hex_rgb(st["pillPrimary"]))
    d.text((W / 2, y + bh / 2), text_fit(d, card.get("button") or "Neem contact op", btn_f, W - pad * 2 - 120 * K), font=btn_f, fill=(255, 255, 255, 255), anchor="mm")
    if state >= 2:
        cx, cy = W - pad - 44 * K, y + bh / 2
        d.line([(cx - 14 * K, cy), (cx - 3 * K, cy + 11 * K), (cx + 16 * K, cy - 12 * K)], fill=(255, 255, 255, 255), width=int(round(6 * K)), joint="curve")
    return img


def render_stat(card, st, fonts, width, height):
    img = Image.new("RGBA", (width * SS, height * SS), hex_rgb(st["statBg"], 236))
    d = ImageDraw.Draw(img)
    v_f = fonts.get("Poppins-Bold", 190 * K)
    l_f = fonts.get("Poppins-Bold", 78 * K)
    s_f = fonts.get("Inter-SemiBold", 40 * K)
    cx, cy = width * SS / 2, height * SS * 0.46
    d.text((cx, cy - 40 * K), card.get("value") or "", font=v_f, fill=(255, 255, 255, 255), anchor="ms")
    if card.get("label"):
        d.text((cx, cy + 50 * K), card["label"], font=l_f, fill=hex_rgb(st["statAccent"]), anchor="ms")
    if card.get("sublabel"):
        d.text((cx, cy + 135 * K), card["sublabel"], font=s_f, fill=(255, 255, 255, 235), anchor="ms")
    return downsample(img)


def card_states(card):
    t = card["template"]
    n = len(card.get("items", []))
    if t == "stat":
        return [1]
    if t == "cta_form":
        return [1, 2] if n else [1]
    if t == "process":
        return list(range(0, n + 1))
    return list(range(1, n + 1)) if n else [0]


def main():
    spec = json.load(open(sys.argv[1], encoding="utf-8"))
    out = sys.argv[2]
    os.makedirs(out, exist_ok=True)
    W, H = spec.get("width", 1080), spec.get("height", 1920)
    global K
    K = SS * float(spec["style"]["cards"].get("scale", 1.0))
    fonts = Fonts(spec["fontDir"])
    cs = spec["style"]["captions"]
    ks = spec["style"]["cards"]
    scale = float(spec.get("captionScale", 1.0))
    off_y = int(spec.get("captionOffsetY", 0))
    manifest = {"captions": {}, "cards": {}}

    for c in spec.get("captions", []):
        img = render_caption(c["text"], cs, fonts, scale)
        f = os.path.join(out, f"cap_{c['id']}.png")
        img.save(f)
        x = int(round(W / 2 - img.width / 2))
        y = int(round(cs["centerYPx"] + off_y - img.height / 2))
        manifest["captions"][c["id"]] = {"file": f, "x": x, "y": y, "w": img.width, "h": img.height}

    for card in spec.get("cards", []):
        if card["template"] == "stat":
            img = render_stat(card, ks, fonts, W, H)
            f = os.path.join(out, f"card_{card['id']}_1.png")
            img.save(f)
            manifest["cards"][card["id"]] = {"states": [{"state": 1, "file": f}], "x": 0, "y": 0, "w": W, "h": H, "fullscreen": True}
            continue
        states = []
        geo = None
        for s in card_states(card):
            if card["template"] == "process":
                raw = render_process(card, s, ks, fonts)
            elif card["template"] == "cta_form":
                raw = render_cta(card, s, ks, fonts)
            else:
                raw = render_list_card(card, s, ks, fonts)
            shadowed, pad = with_shadow(raw, ks["radiusPx"] * K)
            img = downsample(shadowed)
            f = os.path.join(out, f"card_{card['id']}_{s}.png")
            img.save(f)
            states.append({"state": s, "file": f})
            if geo is None:
                p = pad // SS
                x = int(round(W / 2 - raw.width / SS / 2)) - p
                y = int(round(ks["bottomYPx"] - raw.height / SS)) - p
                geo = {"x": x, "y": y, "w": img.width, "h": img.height, "pad": p}
        manifest["cards"][card["id"]] = {"states": states, **geo, "fullscreen": False}

    with open(os.path.join(out, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh)
    return 0


if __name__ == "__main__":
    sys.exit(main())
