from nurb import *


@part
def leg_cup(pocket_depth=8.0, wall=2.0, clearance=0.4):
    leg_width = measured("leg_width")
    leg_depth = measured("leg_depth")
    lift = measured("lift")

    if lift < 1.0:
        reject("lift under 1.0 leaves no usable floor under the foot: raise it to 2.0 or more")

    pocket_x = leg_width + clearance
    pocket_y = leg_depth + clearance

    outer_x = pocket_x + 2 * wall
    outer_y = pocket_y + 2 * wall
    height = lift + pocket_depth

    body = Box(outer_x, outer_y, height, align=(Align.CENTER, Align.CENTER, Align.MIN))
    pocket = Pos(0, 0, lift) * Box(pocket_x, pocket_y, pocket_depth + 1.0, align=(Align.CENTER, Align.CENTER, Align.MIN))
    return body - pocket
