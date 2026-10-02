#!/usr/bin/env python3
"""
Draws the home screen icon: a house wearing a bow tie.

Run by hand when the icon changes; the PNGs it writes are committed:

    python3 scripts/make-icons.py

The manifest route (app/manifest.webmanifest/route.ts) promises exactly the
two sizes written here, and the root layout the apple-touch-icon. Without them iOS puts a screenshot of the page on the
home screen instead of an icon.

Everything is drawn in a 512-unit design space and supersampled 4x before
downsampling, because PIL's polygons are hard-aliased — the roof and the bow
tie would have visibly stepped edges otherwise.
"""

from PIL import Image, ImageDraw

S = 512   # final size, matching the larger icon the manifest asks for
F = 4     # supersample factor

MARIGOLD = (242, 163,  60, 255)   # background
CREAM    = (255, 246, 232, 255)   # the house
CORAL    = (228,  87,  46, 255)   # the bow tie


def s(*vals):
    """Scale design coordinates into the supersampled canvas."""
    return tuple(v * F for v in vals)


def draw(rounded):
    img = Image.new('RGBA', (S * F, S * F), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    # Background. Rounded for Android and browser tabs; square for iOS, which
    # masks its own corners and fills any transparency it finds with black.
    if rounded:
        d.rounded_rectangle(s(0, 0, 512, 512), radius=96 * F, fill=MARIGOLD)
    else:
        d.rectangle(s(0, 0, 512, 512), fill=MARIGOLD)

    # House body, then a roof that overhangs it slightly on both sides.
    d.rounded_rectangle(s(156, 248, 356, 404), radius=13 * F, fill=CREAM)
    d.polygon([s(256, 108), s(390, 252), s(122, 252)], fill=CREAM)

    # The bow tie. Sized to stay a recognisable shape rather than a coral smudge
    # at the ~60pt a home screen actually renders.
    d.polygon([s(256, 322), s(199, 291), s(199, 353)], fill=CORAL)
    d.polygon([s(256, 322), s(313, 291), s(313, 353)], fill=CORAL)
    d.rounded_rectangle(s(240, 306, 272, 338), radius=10 * F, fill=CORAL)

    # A lit attic window, so it reads as a house someone lives in.
    d.ellipse(s(238, 178, 274, 214), fill=MARIGOLD)

    return img.resize((S, S), Image.LANCZOS)


full = draw(rounded=True)
full.save('public/icons/icon-512.png')
full.resize((192, 192), Image.LANCZOS).save('public/icons/icon-192.png')

# What iOS actually puts on the home screen: the root layout points
# apple-touch-icon here, and Safari prefers it over the manifest's icons.
draw(rounded=False).resize((180, 180), Image.LANCZOS).save('public/icons/apple-touch-icon.png')
print('wrote public/icons/icon-192.png, icon-512.png and apple-touch-icon.png')
