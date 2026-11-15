"""AI use: the code in this file was written by an AI coding assistant (Claude, by Anthropic), directed by the team. See "Use of AI tools" in README.md.

Red Route: build the astronaut for the 3D walk in Blender and export it as docs/walk3d/models/astronaut.glb.

Run it inside Blender (tested with 5.2): Scripting tab > Open this file > Run Script.
It builds the model in its own scene ("RedRouteAstronaut") and leaves every other scene alone.

The model is original: a generic surface suit with human proportions (about 1.86 m to the top of the helmet), no agency
logos and no flags. Each body segment is its own object with its origin at the joint (hips, torso, head, upper and lower
arms, hands, upper and lower legs, feet), so docs/walk3d/walk3d.js can animate the walk by rotating those joints.
Blender axes: +Z up, the astronaut faces -Y, its left side is +X.
"""
import math
import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

R = math.radians
SCENE = "RedRouteAstronaut"


def xf(loc, rot=(0, 0, 0), scale=(1, 1, 1)):
    return Matrix.Translation(Vector(loc)) @ Euler(rot, "XYZ").to_matrix().to_4x4() @ Matrix.Diagonal(Vector((scale[0], scale[1], scale[2], 1.0)))


def material(name, color, rough=0.8, metal=0.0, emit=None, strength=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        m.node_tree.nodes.clear()
        bsdf = m.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
        out = m.node_tree.nodes.new("ShaderNodeOutputMaterial")
        m.node_tree.links.new(bsdf.outputs[0], out.inputs[0])
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (emit[0], emit[1], emit[2], 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    m.diffuse_color = (color[0], color[1], color[2], 1)
    return m


def smooth_sections(secs, steps=3):
    """Catmull-Rom between the given rings, so a limb drawn from five rings still has a soft outline."""
    secs = [tuple(s) + (0.0,) * (4 - len(s)) for s in secs]
    out = []
    for i in range(len(secs) - 1):
        p0, p1, p2, p3 = secs[max(i - 1, 0)], secs[i], secs[i + 1], secs[min(i + 2, len(secs) - 1)]
        for k in range(steps):
            t = k / steps
            out.append(tuple(0.5 * (2 * p1[j] + (p2[j] - p0[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t * t
                                    + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t ** 3) for j in range(4)))
    out.append(secs[-1])
    return out


class Part:
    """One body segment: a mesh object whose origin sits at its joint."""

    def __init__(self, name, origin):
        self.name, self.o, self.bm, self.mats = name, Vector(origin), bmesh.new(), []

    def mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def mx(self, loc, rot=(0, 0, 0), scale=(1, 1, 1)):
        return Matrix.Translation(-self.o) @ xf(loc, rot, scale)

    def merge(self, tmp, mat=None, sharp=40):
        """Add a temporary bmesh to this part: smooth shading, hard edges where faces meet at more than `sharp` degrees."""
        idx = self.mi(mat) if mat is not None else None
        for f in tmp.faces:
            f.smooth = True
            if idx is not None:
                f.material_index = idx
        for e in tmp.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0) > R(sharp):
                e.smooth = False
        me = bpy.data.meshes.new("_tmp")
        tmp.to_mesh(me)
        tmp.free()
        self.bm.from_mesh(me)
        bpy.data.meshes.remove(me)

    def loft(self, mat, cx, cy, secs, seg=28):
        """A limb or trunk: elliptical rings (z, rx, ry[, y shift]) around the axis (cx, cy), joined into one skin."""
        tmp, rings = bmesh.new(), []
        for z, rx, ry, dy in smooth_sections(secs):
            rings.append([tmp.verts.new((cx - self.o.x + rx * math.cos(2 * math.pi * k / seg), cy + dy - self.o.y + ry * math.sin(2 * math.pi * k / seg), z - self.o.z))
                          for k in range(seg)])
        for a, b in zip(rings, rings[1:]):
            for k in range(seg):
                tmp.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
        tmp.faces.new(rings[0])
        tmp.faces.new(rings[-1])
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        self.merge(tmp, mat, sharp=55)

    def sphere(self, mat, loc, r=1.0, scale=(1, 1, 1), rot=(0, 0, 0), u=24, v=12):
        tmp = bmesh.new()
        bmesh.ops.create_uvsphere(tmp, u_segments=u, v_segments=v, radius=r, matrix=self.mx(loc, rot, scale))
        self.merge(tmp, mat)

    def cyl(self, mat, loc, r1, r2, h, rot=(0, 0, 0), seg=24, caps=True, scale=(1, 1, 1)):
        """Cylinder or cone along Z: r1 at the bottom, r2 at the top."""
        tmp = bmesh.new()
        bmesh.ops.create_cone(tmp, cap_ends=caps, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h, matrix=self.mx(loc, rot, scale))
        self.merge(tmp, mat)

    def tube(self, mat, p0, p1, r, seg=12, r_end=None):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        tmp = bmesh.new()
        m = Matrix.Translation((p0 + p1) / 2 - self.o) @ d.to_track_quat("Z", "Y").to_matrix().to_4x4()
        bmesh.ops.create_cone(tmp, cap_ends=True, cap_tris=False, segments=seg, radius1=r, radius2=r if r_end is None else r_end, depth=d.length, matrix=m)
        self.merge(tmp, mat)

    def box(self, mat, loc, size, rot=(0, 0, 0), bevel=0.01, seg=3):
        tmp = bmesh.new()
        bmesh.ops.create_cube(tmp, size=1.0, matrix=self.mx(loc, rot, size))
        if bevel > 0:
            bmesh.ops.bevel(tmp, geom=tmp.edges[:], offset=bevel, offset_type="OFFSET", segments=seg, profile=0.5, affect="EDGES", clamp_overlap=True)
        self.merge(tmp, mat)

    def torus(self, mat, loc, R_, r, rot=(0, 0, 0), scale=(1, 1, 1), seg=32, tseg=8):
        tmp = bmesh.new()
        rings = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            rings.append([tmp.verts.new(((R_ + r * math.cos(2 * math.pi * j / tseg)) * math.cos(a), (R_ + r * math.cos(2 * math.pi * j / tseg)) * math.sin(a),
                                         r * math.sin(2 * math.pi * j / tseg))) for j in range(tseg)])
        for i in range(seg):
            a, b = rings[i], rings[(i + 1) % seg]
            for j in range(tseg):
                tmp.faces.new((a[j], b[j], b[(j + 1) % tseg], a[(j + 1) % tseg]))
        bmesh.ops.recalc_face_normals(tmp, faces=tmp.faces[:])
        bmesh.ops.transform(tmp, matrix=self.mx(loc, rot, scale), verts=tmp.verts[:])
        self.merge(tmp, mat)

    def shell(self, mat, loc, r, keep, scale=(1, 1, 1), u=48, v=24):
        """Part of a sphere: keep(lon_deg, lat_deg) picks the faces. lon 0 is straight ahead (-Y)."""
        tmp = bmesh.new()
        bmesh.ops.create_uvsphere(tmp, u_segments=u, v_segments=v, radius=r)
        drop = []
        for f in tmp.faces:
            c = f.calc_center_median().normalized()
            if not keep(math.degrees(math.atan2(c.x, -c.y)), math.degrees(math.asin(max(-1, min(1, c.z))))):
                drop.append(f)
        bmesh.ops.delete(tmp, geom=drop, context="FACES")
        bmesh.ops.transform(tmp, matrix=self.mx(loc, (0, 0, 0), scale), verts=tmp.verts[:])
        self.merge(tmp, mat)

    def helmet(self, shell, visor, frame, loc, r, scale=(1, 1, 1)):
        tmp = bmesh.new()
        bmesh.ops.create_uvsphere(tmp, u_segments=48, v_segments=24, radius=r)
        i_shell, i_visor, i_frame = self.mi(shell), self.mi(visor), self.mi(frame)
        vis = []
        for f in tmp.faces:
            c = f.calc_center_median().normalized()
            lon, lat = math.degrees(math.atan2(c.x, -c.y)), math.degrees(math.asin(max(-1, min(1, c.z))))
            f.material_index = i_shell
            if abs(lon) < 71 and -37 < lat < 40:
                f.material_index = i_visor
                vis.append(f)
        res = bmesh.ops.inset_region(tmp, faces=vis, thickness=0.009, depth=-0.006, use_even_offset=True, use_boundary=True)
        for f in res["faces"]:
            f.material_index = i_frame
        bmesh.ops.transform(tmp, matrix=self.mx(loc, (0, 0, 0), scale), verts=tmp.verts[:])
        self.merge(tmp, None, sharp=28)

    def build(self, coll, parent=None):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        coll.objects.link(ob)
        ob.location = self.o - (parent["o"] if parent else Vector((0, 0, 0)))
        if parent:
            ob.parent = parent["ob"]
        return {"ob": ob, "o": self.o}


def build(coll):
    white = material("SuitWhite", (0.80, 0.78, 0.73), 0.9)
    dusty = material("SuitDusty", (0.56, 0.44, 0.34), 0.95)              # boots: Mars dust on the fabric
    cloth = material("SuitGrey", (0.42, 0.42, 0.43), 0.88)
    metal = material("Metal", (0.56, 0.58, 0.62), 0.32, 0.9)
    dark = material("Hardware", (0.035, 0.038, 0.045), 0.5, 0.2)
    rubber = material("Rubber", (0.02, 0.022, 0.026), 0.75)
    red = material("RedRoute", (1.0, 0.144, 0.047), 0.6)                 # the planner's route colour, #ff6a3d
    visor = material("VisorGold", (0.90, 0.46, 0.06), 0.1, 1.0)
    screen = material("Screen", (0.01, 0.03, 0.04), 0.3, 0.0, emit=(0.15, 0.85, 1.0), strength=2.5)
    lamp = material("Lamp", (0.9, 0.9, 0.85), 0.3, 0.0, emit=(1.0, 0.95, 0.8), strength=4.0)
    status = material("StatusLight", (0.02, 0.2, 0.05), 0.4, 0.0, emit=(0.2, 1.0, 0.35), strength=3.0)

    root = bpy.data.objects.new("Astronaut", None)
    coll.objects.link(root)
    rootp = {"ob": root, "o": Vector((0, 0, 0))}

    # ---- hips ----
    p = Part("Hips", (0, 0, 0.96))
    p.loft(white, 0, 0.004, [(0.865, 0.085, 0.085), (0.90, 0.150, 0.118), (0.95, 0.172, 0.128), (1.00, 0.170, 0.126), (1.05, 0.160, 0.120), (1.09, 0.152, 0.114)], seg=36)
    p.torus(metal, (0, 0.004, 1.088), 0.153, 0.013, scale=(1, 0.75, 1), seg=44)
    p.torus(cloth, (0, 0.004, 1.062), 0.158, 0.011, scale=(1, 0.75, 1), seg=44)
    for x in (-0.095, 0.095):                                                      # tether rings
        p.torus(metal, (x, -0.122, 1.0), 0.018, 0.004, rot=(R(90), 0, 0), seg=20, tseg=6)
        p.box(cloth, (x, -0.116, 1.024), (0.024, 0.01, 0.032), bevel=0.003)
    p.box(cloth, (-0.188, 0.0, 0.955), (0.055, 0.12, 0.13), bevel=0.013)          # sample bag, right hip
    p.box(white, (-0.191, 0.0, 1.008), (0.06, 0.125, 0.034), bevel=0.01)
    p.cyl(red, (-0.222, 0.0, 1.0), 0.009, 0.009, 0.006, rot=(0, R(90), 0), seg=14)
    p.tube(dark, (0.19, 0.025, 0.85), (0.19, 0.0, 1.06), 0.0095)                   # geology hammer, left hip
    p.box(metal, (0.19, -0.004, 1.072), (0.027, 0.098, 0.026), bevel=0.005)
    p.box(cloth, (0.181, 0.01, 0.975), (0.024, 0.04, 0.05), bevel=0.005)
    hips = p.build(coll, rootp)

    # ---- torso: chest, chest controls, life-support pack ----
    p = Part("Torso", (0, 0, 1.085))
    p.loft(white, 0, 0.004, [(1.07, 0.150, 0.112), (1.11, 0.146, 0.110), (1.17, 0.156, 0.118), (1.25, 0.178, 0.132), (1.33, 0.192, 0.142),
                             (1.41, 0.196, 0.142), (1.47, 0.186, 0.128), (1.515, 0.140, 0.108), (1.548, 0.112, 0.100)], seg=40)
    for z in (1.108, 1.136):
        p.torus(cloth, (0, 0.004, z), 0.149, 0.011, scale=(1, 0.75, 1), seg=44)
    p.cyl(metal, (0, 0.0, 1.555), 0.118, 0.118, 0.03, seg=40)                      # neck ring
    p.torus(metal, (0, 0.0, 1.572), 0.118, 0.009, seg=44)
    p.torus(dark, (0, 0.0, 1.539), 0.122, 0.008, seg=44)
    for s in (-1, 1):
        p.torus(metal, (s * 0.2, 0, 1.47), 0.087, 0.012, rot=(0, R(90), 0), seg=36)          # shoulder bearings
        p.tube(cloth, (s * 0.095, -0.112, 1.5), (s * 0.085, -0.142, 1.385), 0.011)           # chest straps
        p.tube(cloth, (s * 0.1, -0.15, 1.31), (s * 0.187, 0.07, 1.26), 0.011)                # hoses to the pack
        p.torus(metal, (s * 0.1, -0.15, 1.31), 0.013, 0.005, rot=(0, R(90), 0), seg=16, tseg=6)
        p.cyl(metal, (s * 0.065, -0.155, 1.392), 0.012, 0.012, 0.025, seg=16)
        p.tube(cloth, (s * 0.115, -0.108, 1.512), (s * 0.115, 0.0, 1.562), 0.016)            # pack straps over the shoulders
        p.tube(cloth, (s * 0.115, 0.0, 1.562), (s * 0.115, 0.125, 1.535), 0.016)
        p.sphere(cloth, (s * 0.115, 0.0, 1.562), 0.0165, u=12, v=8)
    p.box(cloth, (0, -0.158, 1.31), (0.2, 0.07, 0.14), bevel=0.012)                # chest control unit
    p.box(dark, (0, -0.1945, 1.337), (0.1, 0.006, 0.052), bevel=0.002)
    p.box(screen, (0, -0.198, 1.337), (0.088, 0.004, 0.04), bevel=0.0012)
    for x in (-0.065, -0.038):
        p.cyl(dark, (x, -0.199, 1.272), 0.011, 0.0095, 0.016, rot=(R(90), 0, 0), seg=16)
    p.cyl(red, (0.065, -0.199, 1.272), 0.012, 0.0105, 0.018, rot=(R(90), 0, 0), seg=16)
    for x in (0.008, 0.03):
        p.box(metal, (x, -0.197, 1.272), (0.009, 0.018, 0.024), bevel=0.002)
    p.sphere(status, (0.078, -0.194, 1.362), 0.0055, u=12, v=8)
    p.cyl(red, (0.105, -0.118, 1.445), 0.028, 0.028, 0.005, rot=(R(90), 0, R(25)), seg=28)      # mission roundel (original design)
    p.cyl(white, (0.1065, -0.1212, 1.445), 0.0185, 0.0185, 0.004, rot=(R(90), 0, R(25)), seg=28)
    p.cyl(red, (0.1078, -0.1238, 1.445), 0.0085, 0.0085, 0.004, rot=(R(90), 0, R(25)), seg=20)
    p.box(dark, (-0.105, -0.118, 1.445), (0.062, 0.005, 0.02), rot=(0, 0, R(-25)), bevel=0.0015)  # name tag
    # life-support pack
    p.box(white, (0, 0.215, 1.325), (0.40, 0.17, 0.60), bevel=0.035, seg=4)
    p.box(cloth, (0, 0.215, 1.642), (0.34, 0.14, 0.04), bevel=0.016)
    p.box(red, (0, 0.215, 1.572), (0.406, 0.176, 0.026), bevel=0.009)
    p.box(cloth, (0, 0.303, 1.36), (0.3, 0.016, 0.38), bevel=0.008)
    for i in range(5):
        p.box(white, (0, 0.314, 1.21 + 0.055 * i), (0.26, 0.01, 0.02), bevel=0.003)
    for x in (-0.075, 0.075):
        p.cyl(dark, (x, 0.312, 1.515), 0.035, 0.035, 0.016, rot=(R(90), 0, 0), seg=24)
        p.cyl(metal, (x, 0.322, 1.515), 0.012, 0.012, 0.008, rot=(R(90), 0, 0), seg=14)
        p.torus(metal, (x, 0.319, 1.515), 0.035, 0.004, rot=(R(90), 0, 0), seg=24, tseg=6)
    for s in (-1, 1):
        p.box(cloth, (s * 0.203, 0.215, 1.325), (0.016, 0.11, 0.48), bevel=0.006)
        p.sphere(metal, (s * 0.17, 0.222, 1.006), 0.058, (0.5, 1, 1), u=20, v=10)
        p.tube(cloth, (s * 0.075, 0.13, 1.6), (s * 0.075, 0.085, 1.557), 0.013)              # pack-to-helmet hoses
        p.sphere(status, (s * 0.15, 0.304, 1.6), 0.0065, u=12, v=8)
    p.cyl(cloth, (0, 0.222, 1.006), 0.058, 0.058, 0.34, rot=(0, R(90), 0), seg=24)           # backup tank under the pack
    p.tube(metal, (-0.15, 0.25, 1.66), (-0.15, 0.25, 1.9), 0.0048, seg=8)                    # antenna
    p.sphere(red, (-0.15, 0.25, 1.904), 0.011, u=12, v=8)
    for x in (-0.075, 0.075):
        p.tube(metal, (x, 0.212, 1.66), (x, 0.212, 1.69), 0.0065, seg=8)
    p.tube(metal, (-0.081, 0.212, 1.69), (0.081, 0.212, 1.69), 0.0065, seg=8)                # carry handle
    torso = p.build(coll, hips)

    # ---- head: helmet, visor, lamps, camera ----
    p = Part("Head", (0, 0, 1.56))
    hc = (0, -0.004, 1.702)
    p.helmet(white, visor, dark, hc, 0.16, (1, 1.04, 1))
    p.shell(white, hc, 0.1652, lambda lon, lat: abs(lon) < 74 and 38 < lat < 63, (1, 1.04, 1))      # sun shade over the visor
    p.shell(cloth, hc, 0.1632, lambda lon, lat: abs(lon) > 150 or (abs(lon) > 74 and -20 < lat < 30), (1, 1.04, 1))
    p.cyl(white, (0, 0, 1.583), 0.122, 0.146, 0.046, seg=40)
    p.box(cloth, (0, -0.132, 1.602), (0.072, 0.03, 0.028), bevel=0.008)
    for s in (-1, 1):
        p.cyl(metal, (s * 0.16, -0.004, 1.702), 0.028, 0.028, 0.018, rot=(0, R(90), 0), seg=24)     # visor hinges
        p.cyl(dark, (s * 0.17, -0.004, 1.702), 0.011, 0.011, 0.006, rot=(0, R(90), 0), seg=14)
        p.box(cloth, (s * 0.147, -0.048, 1.765), (0.04, 0.062, 0.04), bevel=0.008)                   # helmet lamps
        p.cyl(lamp, (s * 0.147, -0.081, 1.765), 0.0155, 0.0155, 0.006, rot=(R(90), 0, 0), seg=18)
        p.torus(metal, (s * 0.147, -0.081, 1.765), 0.0165, 0.003, rot=(R(90), 0, 0), seg=18, tseg=6)
    p.box(dark, (0.0, -0.022, 1.874), (0.048, 0.074, 0.032), bevel=0.006)                            # camera
    p.cyl(metal, (0.0, -0.063, 1.874), 0.0125, 0.011, 0.018, rot=(R(90), 0, 0), seg=16)
    p.cyl(dark, (0.0, -0.073, 1.874), 0.0085, 0.0085, 0.003, rot=(R(90), 0, 0), seg=14)
    head = p.build(coll, torso)

    parts = {"Astronaut": rootp, "Hips": hips, "Torso": torso, "Head": head}
    for s, side in ((1, "L"), (-1, "R")):
        x = s * 0.25
        # ---- upper arm ----
        p = Part(f"ArmUpper_{side}", (s * 0.215, 0, 1.475))
        p.sphere(white, (s * 0.236, 0, 1.468), 0.083, (1, 1, 1.05), u=28, v=14)
        p.loft(white, x, 0, [(1.455, 0.066, 0.068), (1.40, 0.071, 0.073), (1.33, 0.067, 0.069), (1.26, 0.060, 0.062), (1.205, 0.055, 0.057)])
        p.cyl(red, (x, 0, 1.345), 0.0715, 0.0735, 0.036, seg=28, scale=(1, 1.03, 1))
        p.torus(white, (x, 0, 1.405), 0.071, 0.008, seg=30)
        for z in (1.207, 1.186, 1.165):
            p.torus(cloth, (x, 0, z), 0.057, 0.0125, seg=30)
        if s == 1:
            p.cyl(red, (x + 0.071, 0, 1.4), 0.026, 0.026, 0.005, rot=(0, R(90), 0), seg=24)
            p.cyl(white, (x + 0.074, 0, 1.4), 0.016, 0.016, 0.003, rot=(0, R(90), 0), seg=24)
        ua = p.build(coll, torso)
        # ---- forearm ----
        p = Part(f"ArmLower_{side}", (x, 0, 1.185))
        p.loft(white, x, 0, [(1.168, 0.054, 0.054), (1.11, 0.058, 0.057), (1.03, 0.053, 0.052), (0.965, 0.046, 0.046), (0.94, 0.045, 0.045)])
        for z, rr in ((1.078, 0.0575), (0.975, 0.048)):
            p.torus(cloth, (x, 0, z), rr, 0.005, seg=28, tseg=6)
        p.cyl(metal, (x, 0, 0.93), 0.05, 0.05, 0.024, seg=28)
        p.torus(metal, (x, 0, 0.944), 0.05, 0.006, seg=28, tseg=6)
        p.torus(dark, (x, 0, 0.917), 0.048, 0.005, seg=28, tseg=6)
        if s == 1:                                                                  # cuff checklist with a small screen
            p.box(dark, (x, -0.059, 1.04), (0.066, 0.014, 0.095), bevel=0.004)
            p.box(screen, (x, -0.0675, 1.043), (0.052, 0.004, 0.07), bevel=0.0012)
            p.torus(cloth, (x, -0.003, 1.04), 0.056, 0.009, seg=28, tseg=6)
        else:                                                                       # wrist mirror
            p.box(metal, (x - 0.058, 0, 1.0), (0.01, 0.05, 0.05), bevel=0.003)
        la = p.build(coll, ua)
        # ---- glove ----
        p = Part(f"Hand_{side}", (x, 0, 0.915))
        p.cyl(cloth, (x, 0, 0.905), 0.043, 0.049, 0.028, seg=24)
        p.box(cloth, (x, 0, 0.86), (0.042, 0.086, 0.092), bevel=0.016, seg=4)
        p.box(white, (x + s * 0.02, 0, 0.852), (0.01, 0.076, 0.045), bevel=0.004)
        for i in range(4):
            y = -0.031 + i * 0.0207
            p.tube(cloth, (x, y, 0.823), (x - s * 0.012, y, 0.752), 0.0102, seg=10)
            p.sphere(rubber, (x - s * 0.012, y, 0.75), 0.011, u=12, v=8)
            p.sphere(cloth, (x, y, 0.822), 0.0108, u=12, v=8)
        p.tube(cloth, (x - s * 0.004, -0.044, 0.872), (x - s * 0.013, -0.07, 0.815), 0.0118, seg=10)
        p.sphere(rubber, (x - s * 0.013, -0.07, 0.813), 0.0126, u=12, v=8)
        hd = p.build(coll, la)
        parts.update({f"ArmUpper_{side}": ua, f"ArmLower_{side}": la, f"Hand_{side}": hd})

        x = s * 0.098
        # ---- thigh ----
        p = Part(f"LegUpper_{side}", (s * 0.095, 0, 0.955))
        p.sphere(white, (x, 0, 0.945), 0.104, u=28, v=14)
        p.loft(white, x, 0, [(0.955, 0.100, 0.104), (0.88, 0.099, 0.106), (0.78, 0.091, 0.097), (0.67, 0.080, 0.085), (0.58, 0.070, 0.074), (0.53, 0.066, 0.069)], seg=30)
        p.cyl(red, (x, 0, 0.72), 0.0865, 0.089, 0.04, seg=30, scale=(1, 1.06, 1))
        p.torus(white, (x, 0, 0.845), 0.098, 0.009, scale=(1, 1.06, 1), seg=30)
        p.box(white, (x + s * 0.088, 0.0, 0.742), (0.026, 0.095, 0.12), bevel=0.01)       # thigh pocket
        p.box(cloth, (x + s * 0.09, 0.0, 0.795), (0.03, 0.1, 0.028), bevel=0.008)
        for z in (0.546, 0.521, 0.496):
            p.torus(cloth, (x, 0, z), 0.066, 0.014, seg=30)
        ul = p.build(coll, hips)
        # ---- shin ----
        p = Part(f"LegLower_{side}", (x, 0, 0.515))
        p.loft(white, x, 0, [(0.498, 0.064, 0.066, 0.0), (0.44, 0.068, 0.073, 0.006), (0.37, 0.067, 0.074, 0.01), (0.28, 0.058, 0.062, 0.006),
                             (0.19, 0.050, 0.052, 0.0), (0.125, 0.048, 0.050, 0.0)], seg=30)
        p.box(cloth, (x, -0.063, 0.512), (0.092, 0.034, 0.105), bevel=0.016, seg=4)        # knee pad
        p.box(white, (x, -0.058, 0.36), (0.066, 0.022, 0.17), bevel=0.01)
        p.torus(cloth, (x, 0, 0.2), 0.052, 0.009, seg=30)
        p.cyl(metal, (x, 0, 0.122), 0.054, 0.054, 0.03, seg=30)
        p.torus(dark, (x, 0, 0.106), 0.052, 0.006, seg=30, tseg=6)
        ll = p.build(coll, ul)
        # ---- boot ----
        p = Part(f"Foot_{side}", (x, 0, 0.105))
        p.cyl(dusty, (x, 0.01, 0.108), 0.05, 0.054, 0.045, seg=28)
        p.box(dusty, (x, -0.03, 0.078), (0.106, 0.235, 0.098), bevel=0.032, seg=4)
        p.sphere(cloth, (x, -0.135, 0.06), 1, (0.052, 0.06, 0.042), u=20, v=10)
        p.box(cloth, (x, -0.03, 0.108), (0.112, 0.036, 0.016), bevel=0.005)
        p.box(rubber, (x, -0.035, 0.02), (0.118, 0.285, 0.036), bevel=0.011)
        p.box(rubber, (x, 0.08, 0.03), (0.11, 0.06, 0.055), bevel=0.009)
        for i in range(5):
            p.box(rubber, (x, -0.15 + 0.056 * i, 0.004), (0.118, 0.024, 0.012), bevel=0.003)
        ft = p.build(coll, ll)
        parts.update({f"LegUpper_{side}": ul, f"LegLower_{side}": ll, f"Foot_{side}": ft})
    return parts


def get_scene():
    sc = bpy.data.scenes.get(SCENE) or bpy.data.scenes.new(SCENE)
    for ob in list(sc.collection.all_objects):          # rebuild from scratch, in this scene only
        bpy.data.objects.remove(ob, do_unlink=True)
    if bpy.context.window:
        bpy.context.window.scene = sc
    return sc


def main(export_path=None, preview_dir=None):
    sc = get_scene()
    parts = build(sc.collection)
    obs = [p["ob"] for p in parts.values()]
    bpy.context.view_layer.update()
    stats = {"objects": len(obs), "tris": sum(sum(len(f.vertices) - 2 for f in o.data.polygons) for o in obs if o.type == "MESH"),
             "height_m": round(max((o.matrix_world @ Vector(c)).z for o in obs if o.type == "MESH" for c in o.bound_box), 3)}
    if preview_dir:
        stats["previews"] = previews(sc, preview_dir)
    if export_path:
        for o in sc.collection.all_objects:
            o.select_set(o in obs)
        bpy.context.view_layer.objects.active = parts["Astronaut"]["ob"]
        bpy.ops.export_scene.gltf(filepath=export_path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                                  export_animations=False, export_cameras=False, export_lights=False, use_active_scene=True)
        stats["glb"] = export_path
    return stats


def previews(sc, folder):
    cam_d = bpy.data.cameras.new("PreviewCam")
    cam = bpy.data.objects.new("PreviewCam", cam_d)
    sc.collection.objects.link(cam)
    sun_d = bpy.data.lights.new("PreviewSun", "SUN")
    sun_d.energy = 3.2
    sun = bpy.data.objects.new("PreviewSun", sun_d)
    sun.rotation_euler = (R(52), 0, R(35))
    sc.collection.objects.link(sun)
    w = bpy.data.worlds.get("PreviewWorld") or bpy.data.worlds.new("PreviewWorld")
    try:
        w.use_nodes = True
    except Exception:
        pass
    bg = next((n for n in w.node_tree.nodes if n.type == "BACKGROUND"), None)
    if bg:
        bg.inputs[0].default_value = (0.55, 0.36, 0.22, 1)
        bg.inputs[1].default_value = 1.0
    sc.world = w
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = 720, 960, 100
    sc.render.image_settings.file_format = "PNG"
    out = []
    for name, pos in (("front", (1.5, -3.3, 1.45)), ("back", (-1.7, 3.2, 1.6)), ("side", (3.6, -0.3, 1.2))):
        cam.location = pos
        cam.rotation_euler = (Vector((0, 0, 0.95)) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
        cam_d.lens = 62
        sc.render.filepath = f"{folder}/astronaut_{name}.png"
        bpy.ops.render.render(write_still=True)
        out.append(sc.render.filepath)
    return out


if __name__ == "__main__":
    print(main())
