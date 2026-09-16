from nurb import *


@part
def bundle_holder(
    bundle_diameter=8.0,
    length=13.0,
    wall=2.4,
    back=2.8,
    clearance=0.4,
    relief=2.0,
    draft=False,
):
    """Wall hook for a horizontal cable bundle, one M4 pan-head screw.

    Back face at X=0 goes on the wall, bundle runs along Y, Z is up on the bed
    and on the wall. The floor blocks the bundle down, the lip blocks it away
    from the wall, the screw seats on the back plate above the channel.
    """
    screw_hole = 4.4   # M4 clearance, as the mounting spec asks
    head_dia = 8.4     # pan head plus driver, from the seat outward
    bore_wall = 4.0    # a loaded hole earns a fastener diameter of wall
    head_gap = 0.6     # air between the lip top and the head underside

    if length < screw_hole + 2 * bore_wall:
        reject(
            f"length {length} leaves under {bore_wall} of wall beside the {screw_hole} bore: raise it above {screw_hole + 2 * bore_wall}",
            param="length",
        )
    if relief > (bundle_diameter + clearance) / 2 - 0.5:
        reject("relief chamfer intrudes on the bundle seat: reduce it", param="relief")

    channel = bundle_diameter + clearance
    lip_top = wall + channel
    front = back + channel + wall
    screw_z = lip_top + head_dia / 2 + head_gap
    height = screw_z + screw_hole / 2 + bore_wall

    profile = Plane.XZ * Polygon(
        (0, 0),
        (front, 0),
        (front, lip_top),
        (back + channel, lip_top),
        (back + channel, wall + relief),
        (back + channel - relief, wall),
        (back + relief, wall),
        (back, wall + relief),
        (back, height),
        (0, height),
        align=None,
    )
    body = extrude(profile, length / 2, both=True)

    bore = Pos(back / 2, 0, screw_z) * Rot(0, 90, 0) * Cylinder(screw_hole / 2, back + 2)
    body = body - bore

    if draft:
        return body

    eps = 1e-3

    def exposed(e):
        if e.geom_type != GeomType.LINE:
            return False
        bb = e.bounding_box()
        if bb.max.X < eps or bb.max.Z < eps:
            return False  # lies in the back face or on the bed
        if bb.size.Z > eps:
            return False  # top edges only: three chamfers meeting leave a sliver triangle
        in_channel = (
            bb.min.X > back - eps
            and bb.max.X < back + channel + eps
            and bb.min.Z < lip_top + eps
            and bb.max.Z > wall - eps
        )
        return not in_channel

    concave = set(concave_edges(body))
    keep = body.edges().filter_by(lambda e: exposed(e) and e not in concave)
    return polish(body, keep, 1.0)
