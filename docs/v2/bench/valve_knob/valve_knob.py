from nurb import *


@part
def valve_knob(
    shaft_diameter=measured("shaft_diameter"),
    shaft_across_flat=measured("shaft_across_flat"),
    bore_clearance=0.5,
    bore_depth=12.5,
    height=15.0,
    core_radius=14.5,
    lobe_radius=6.0,
    lobe_offset=13.0,
    lobe_count=3,
    draft=False,
):
    """Bore-up as it prints; flips over onto the valve stem in use. The stem's flat faces +X."""
    if shaft_across_flat >= shaft_diameter:
        reject(
            f"shaft_across_flat {shaft_across_flat} must be under shaft_diameter {shaft_diameter}: a D-shaft is narrower across the flat",
            param="shaft_across_flat",
        )
    if bore_depth + 2.0 > height:
        reject(
            f"bore_depth {bore_depth} leaves under 2mm of floor in a {height} tall knob: raise height above {bore_depth + 2.0}",
            param="bore_depth",
        )

    bore_radius = (shaft_diameter + bore_clearance) / 2
    bore_flat = shaft_across_flat + bore_clearance
    if core_radius < bore_radius + 3.0:
        reject(
            f"core_radius {core_radius} leaves under 3mm of wall around the bore: raise it above {bore_radius + 3.0}",
            param="core_radius",
        )

    # Body: a round core with lobes for wet-hand grip.
    body = Cylinder(core_radius, height, align=(Align.CENTER, Align.CENTER, Align.MIN))
    for i in range(lobe_count):
        lobe = Cylinder(lobe_radius, height, align=(Align.CENTER, Align.CENTER, Align.MIN))
        body = body + Rot(0, 0, 360.0 * i / lobe_count) * Pos(lobe_offset, 0, 0) * lobe

    if not draft:
        top = body.bounding_box().max.Z
        rim = body.edges().filter_by(lambda e: e.bounding_box().min.Z > top - 0.01)
        body = polish(body, rim, 1.0)

    # D-bore: a round bore with one flat facing +X, open at the top.
    flat_x = bore_flat - bore_radius
    big = shaft_diameter * 2
    profile = Circle(bore_radius) - Pos(flat_x + big / 2, 0) * Rectangle(big, big)
    bore = Pos(0, 0, height - bore_depth) * extrude(profile, bore_depth)
    return body - bore
