from nurb import *


@part
def bit_block(
    shank_diameter=measured("shank_diameter"),
    columns=5,
    rows=2,
    clearance=0.3,
    pocket_depth=12.0,
    wall=2.0,
    floor=3.0,
    chamfer_size=0.8,
    draft=False,
):
    if columns < 1:
        reject("columns must be at least 1", param="columns")
    if rows < 1:
        reject("rows must be at least 1", param="rows")
    pocket_dia = shank_diameter + clearance
    if pocket_dia < 2.0:
        reject("shank_diameter gives a pocket under 2mm, which will not print open", param="shank_diameter")
    if wall < 2 * chamfer_size + 0.2:
        reject("wall is too thin for the mouth chamfers on both sides", param="wall")

    pitch = pocket_dia + wall
    length = columns * pitch + wall
    width = rows * pitch + wall
    height = floor + pocket_depth

    block = Box(length, width, height, align=(Align.CENTER, Align.CENTER, Align.MIN))
    pocket = Cylinder(pocket_dia / 2, pocket_depth + 1.0, align=(Align.CENTER, Align.CENTER, Align.MIN))
    x0 = -(columns - 1) * pitch / 2
    y0 = -(rows - 1) * pitch / 2
    for c in range(columns):
        for r in range(rows):
            block = block - Pos(x0 + c * pitch, y0 + r * pitch, floor) * pocket

    if draft:
        return block

    top = block.edges().filter_by(lambda e: e.bounding_box().min.Z > height - 1e-3)
    return chamfer(top, chamfer_size)
