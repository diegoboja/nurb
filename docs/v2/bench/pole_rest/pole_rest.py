from nurb import *

AXIS_HEIGHT = 18.0  # pole axis above the bed, fixed by the row of rests


@part
def pole_rest(pole_diameter=measured("pole_diameter"), length=24.0, wall=2.5, seat_gap=0.25, draft=False):
    seat_r = pole_diameter / 2 + seat_gap
    if seat_r + wall > AXIS_HEIGHT:
        reject(f"pole_diameter {pole_diameter} needs a seat deeper than the 18mm axis height allows: keep it under {2 * (AXIS_HEIGHT - wall - seat_gap):.1f}", param="pole_diameter")
    half_w = seat_r + wall
    block = Box(2 * half_w, length, AXIS_HEIGHT, align=(Align.CENTER, Align.CENTER, Align.MIN))
    seat = Pos(0, 0, AXIS_HEIGHT) * Rot(90, 0, 0) * Cylinder(seat_r, length + 2)
    body = block - seat
    if draft:
        return body

    def exposed(e):
        # Not lying in the bed face, not part of the seat (fit geometry), and not the
        # short tip-end edges: three chamfers meeting there would leave corner slivers.
        c = e.center()
        on_bed = e.bounding_box().max.Z < 0.01
        on_seat = Vector(c.X, 0, c.Z - AXIS_HEIGHT).length < seat_r + 0.05
        tip_end = c.Z > AXIS_HEIGHT - 0.01 and e.length < wall + 0.01
        return not (on_bed or on_seat or tip_end)

    return polish(body, body.edges().filter_by(exposed), 1.0)
