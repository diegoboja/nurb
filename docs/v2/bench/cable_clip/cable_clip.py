from nurb import *


@part
def cable_clip(
    bundle_diameter=measured("bundle_diameter"),
    wall=2.4,
    base=3.0,
    length=12.0,
    tab_length=10.0,
    hole_diameter=4.2,
):
    """Screw-down cable clip: open-top channel along Y, mounting tab along +X."""
    channel_width = bundle_diameter + 0.4
    channel_depth = bundle_diameter
    body_width = channel_width + 2 * wall
    height = base + channel_depth

    body = Box(body_width, length, height, align=(Align.MIN, Align.CENTER, Align.MIN))

    # Tab overlaps the wall by 1mm so the union is one solid, flush with the bottom.
    tab = Pos(body_width - 1.0, 0, 0) * Box(
        tab_length + 1.0, length, base, align=(Align.MIN, Align.CENTER, Align.MIN)
    )
    clip = body + tab

    # Open-top channel, square corners, runs the full length.
    channel = Pos(wall, 0, base) * Box(
        channel_width, length + 2.0, channel_depth + 1.0,
        align=(Align.MIN, Align.CENTER, Align.MIN),
    )
    clip = clip - channel

    # Vertical through-hole centred in the tab.
    hole = Pos(body_width + tab_length / 2, 0, -1.0) * Cylinder(
        hole_diameter / 2, base + 2.0, align=(Align.CENTER, Align.CENTER, Align.MIN)
    )
    return clip - hole
