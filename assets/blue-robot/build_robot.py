"""Rebuild with Blender --background --python build_robot.py. No external assets."""
import bpy, math, os, json
from mathutils import Vector
OUT=os.path.dirname(os.path.abspath(__file__))
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)

def mat(name,c,metal=0,rough=.3,glow=0):
 m=bpy.data.materials.new(name); m.diffuse_color=(*c,1); m.use_nodes=True
 p=m.node_tree.nodes.get('Principled BSDF'); p.inputs['Base Color'].default_value=(*c,1); p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
 if glow: p.inputs['Emission Color'].default_value=(*c,1); p.inputs['Emission Strength'].default_value=glow
 return m
blue=mat('Azure enamel',(.006,.15,.72),.16,.3); white=mat('Porcelain white',(.86,.92,.98),.16,.26)
dark=mat('Graphite joint rubber',(.025,.047,.073),.35,.32); ink=mat('Face ink',(.007,.016,.031),.1,.24)
cyan=mat('Cyan light',(.015,.71,1),.2,.22,2); silver=mat('Brushed alloy',(.39,.52,.62),.7,.26)
parts=[]; bindings={}
def finish(o,name,ma,bone):
 o.name=name; o.data.materials.append(ma)
 if o.type=='MESH':
  for p in o.data.polygons:p.use_smooth=True
 parts.append(o); bindings[o.name]=bone
 return o

def ball(name,loc,scale,ma,bone):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,location=loc); o=bpy.context.object; o.scale=scale
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 return finish(o,name,ma,bone)

def box(name,loc,scale,rad,ma,bone):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc); o=bpy.context.object; o.dimensions=(scale[0],max(scale[1],rad*2.1),scale[2])
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 mod=o.modifiers.new('Soft molded corners','BEVEL'); mod.width=rad; mod.segments=6
 bpy.context.view_layer.objects.active=o; bpy.ops.object.modifier_apply(modifier=mod.name)
 o.scale.y=scale[1]/max(scale[1],rad*2.1)
 bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
 mod=o.modifiers.new('Weighted normals','WEIGHTED_NORMAL'); bpy.ops.object.modifier_apply(modifier=mod.name)
 return finish(o,name,ma,bone)

def rod(name,a,b,r1,r2,ma,bone):
 a,b=Vector(a),Vector(b); d=b-a
 bpy.ops.mesh.primitive_cone_add(vertices=32,radius1=r1,radius2=r2,depth=d.length,location=(a+b)/2)
 o=bpy.context.object; o.rotation_euler=d.to_track_quat('Z','Y').to_euler()
 mod=o.modifiers.new('Edge rounding','BEVEL'); mod.width=.025; mod.segments=3
 bpy.ops.object.modifier_apply(modifier=mod.name)
 return finish(o,name,ma,bone)

def line(name,coords,width,ma,bone):
 cu=bpy.data.curves.new(name,'CURVE'); cu.dimensions='3D'; cu.bevel_depth=width; cu.bevel_resolution=4
 sp=cu.splines.new('BEZIER'); sp.bezier_points.add(len(coords)-1)
 for p,co in zip(sp.bezier_points,coords):p.co=co;p.handle_left_type='AUTO';p.handle_right_type='AUTO'
 ob=bpy.data.objects.new(name,cu);bpy.context.collection.objects.link(ob);bpy.context.view_layer.objects.active=ob;ob.select_set(True)
 bpy.ops.object.convert(target='MESH'); ob=bpy.context.object;ob.select_set(False)
 return finish(ob,name,ma,bone)

# Front faces negative Y; height ~2.7 m including antenna.
ball('Pelvis', (0,0,1.03),(.26,.2,.19),dark,'hips')
ball('Torso blue breastplate',(0,0,1.36),(.34,.23,.40),blue,'chest')
for s in [-1,1]:ball('Torso side inset '+str(s),(s*.245,-.015,1.15),(.085,.205,.15),white,'chest')
rod('Neck piston',(0,0,1.65),(0,0,1.81),.115,.115,dark,'chest')
rod('Neck collar',(0,0,1.67),(0,0,1.72),.16,.16,silver,'chest')
# Chest concentric illuminated emblem.
rod('Emblem alloy rim',(0,-.215,1.43),(0,-.255,1.43),.116,.116,white,'chest')
rod('Emblem cyan ring',(0,-.255,1.43),(0,-.267,1.43),.092,.092,cyan,'chest')
rod('Emblem blue core',(0,-.268,1.43),(0,-.278,1.43),.070,.070,blue,'chest')
box('Helmet blue shell',(0,0,2.10),(1.07,.68,.91),.29,blue,'head')
box('Face graphite gasket',(0,-.326,2.08),(.935,.075,.733),.235,dark,'head')
box('Face white panel',(0,-.373,2.08),(.892,.085,.683),.218,white,'head')
for s in [-1,1]:
 x=s*.222
 ball('Eye socket '+str(s),(x,-.426,2.105),(.086,.028,.132),ink,'head')
 ball('Eye cyan pupil '+str(s),(x-s*.008,-.451,2.11),(.037,.014,.073),cyan,'head')
 ball('Eye glint '+str(s),(x-.011,-.463,2.148),(.014,.007,.021),white,'head')
 line('Eyebrow '+str(s),[(x-.054,-.423,2.299),(x,-.432,2.319),(x+.052,-.423,2.306)],.014,ink,'head')
 rod('Ear dark base '+str(s),(s*.50,0,2.08),(s*.58,0,2.08),.224,.224,dark,'head')
 rod('Ear white housing '+str(s),(s*.56,0,2.08),(s*.63,0,2.08),.222,.222,white,'head')
 rod('Ear azure cap '+str(s),(s*.63,0,2.08),(s*.66,0,2.08),.168,.168,blue,'head')
 rod('Ear luminous trim '+str(s),(s*.661,0,2.08),(s*.672,0,2.08),.13,.13,cyan,'head')
line('Friendly smile',[(-.085,-.429,1.98),(-.047,-.444,1.948),(0,-.448,1.94),(.047,-.444,1.948),(.085,-.429,1.98)],.016,ink,'head')
rod('Antenna stem',(0,.015,2.52),(0,.015,2.70),.035,.027,dark,'head')
ball('Antenna base',(0,.015,2.54),(.09,.085,.035),silver,'head')
ball('Antenna blue beacon',(0,.015,2.735),(.09,.09,.095),blue,'head')
ball('Beacon glint',(-.025,-.059,2.771),(.018,.01,.021),cyan,'head')
bones=[('hips',(0,0,.92),(0,0,1.14),None),('chest',(0,0,1.14),(0,0,1.72),'hips'),('head',(0,0,1.72),(0,0,2.5),'chest')]
for s,side in [(1,'L'),(-1,'R')]:
 sh=(s*.36,0,1.58); el=(s*.54,0,1.27); wr=(s*.66,-.015,.99)
 up='upper_arm.'+side; fore='forearm.'+side; hand='hand.'+side
 bones += [(up,sh,el,'chest'),(fore,el,wr,up),(hand,wr,(s*.72,-.015,.77),fore)]
 ball('Shoulder pivot.'+side,sh,(.137,.14,.14),dark,up)
 rod('Shoulder white armor.'+side,(s*.34,0,1.61),(s*.43,0,1.46),.14,.125,white,up)
 rod('Upper arm blue.'+side,(s*.43,0,1.45),(s*.51,0,1.31),.085,.09,blue,up)
 ball('Elbow joint.'+side,el,(.09,.09,.09),dark,fore)
 rod('Forearm blue gauntlet.'+side,(s*.565,0,1.22),(s*.64,-.015,1.045),.108,.155,blue,fore)
 rod('White wrist cuff.'+side,(s*.635,-.014,1.055),wr,.159,.145,white,fore)
 ball('Palm.'+side,(s*.69,-.015,.88),(.14,.095,.145),blue,hand)
 for i in range(4):
  x=s*(.603+i*.052); z=.795+(.015 if i in [1,2] else .035)
  rod('Finger.%s.%d'%(side,i),(x,-.03,.89),(x+s*.025,-.045,z),.028,.031,blue,hand)
  ball('Fingertip.%s.%d'%(side,i),(x+s*.025,-.045,z),(.031,.031,.036),blue,hand)
 ball('Thumb.'+side,(s*.59,-.088,.90),(.053,.052,.075),blue,hand)
 hip=(s*.19,0,1.01); knee=(s*.245,0,.66); ankle=(s*.28,0,.23)
 thigh='thigh.'+side; shin='shin.'+side; foot='foot.'+side
 bones += [(thigh,hip,knee,'hips'),(shin,knee,ankle,thigh),(foot,ankle,(s*.28,-.28,.13),shin)]
 ball('Hip pivot.'+side,hip,(.105,.115,.115),dark,thigh)
 rod('Thigh blue.'+side,(s*.20,0,.95),(s*.237,0,.73),.095,.11,blue,thigh)
 ball('Knee joint.'+side,knee,(.10,.105,.09),dark,shin)
 rod('Shin blue boot.'+side,(s*.25,0,.60),(s*.28,0,.26),.105,.17,blue,shin)
 rod('Ankle cuff.'+side,(s*.277,0,.31),(s*.28,0,.265),.174,.18,white,shin)
 box('White shoe sole.'+side,(s*.29,-.105,.095),(.43,.62,.12),.05,white,foot)
 ball('Blue rounded shoe.'+side,(s*.29,-.13,.20),(.215,.30,.16),blue,foot)
 ball('Shoe heel insert.'+side,(s*.29,.105,.205),(.17,.055,.10),white,foot)
# Rigid skinning preserves mechanical joint shapes while allowing game animation.
bpy.ops.object.select_all(action='DESELECT')
arm=bpy.data.armatures.new('Robot skeleton');rig=bpy.data.objects.new('BlueRobot_Rig',arm);bpy.context.collection.objects.link(rig);bpy.context.view_layer.objects.active=rig;rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for name,head,tail,parent in bones:
 b=arm.edit_bones.new(name);b.head=head;b.tail=tail
 if parent:b.parent=arm.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT');rig.show_in_front=True
for ob in parts:
 group=ob.vertex_groups.new(name=bindings[ob.name]);group.add(list(range(len(ob.data.vertices))),1,'REPLACE')
 mod=ob.modifiers.new('Rigid robot skin','ARMATURE');mod.object=rig;ob.parent=rig
rig['description']='Reference-inspired blue companion robot. Neutral relaxed A-pose; rigid weighted mechanical rig; no animations.'
# Export character only, no display scene.
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
for ob in parts:ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,'blue_robot.glb'),export_format='GLB',use_selection=True,export_animations=False)
# Studio preview.
floor=mat('Studio matte',(.83,.87,.93),0,.78)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,.025));bpy.context.object.name='Studio floor';bpy.context.object.data.materials.append(floor)
def aim(o,point):o.rotation_euler=(Vector(point)-o.location).to_track_quat('-Z','Y').to_euler()
for name,loc,power,size in [('Key',(-3,-4,6),650,4),('Fill',(4,-2,4),450,3),('Rim',(1,3,5),850,3)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;aim(o,(0,0,1.4))
bpy.ops.object.camera_add(location=(3,-8,3));cam=bpy.context.object;aim(cam,(0,0,1.40));cam.data.type='ORTHO';cam.data.ortho_scale=3.45
sc=bpy.context.scene;sc.camera=cam;sc.render.engine='CYCLES';sc.cycles.samples=48
sc.cycles.use_denoising=True;sc.world.color=(.32,.32,.32);sc.render.resolution_x=1100;sc.render.resolution_y=1100;sc.render.resolution_percentage=100
sc.view_settings.view_transform='AgX';sc.render.image_settings.file_format='PNG';sc.render.filepath=os.path.join(OUT,'preview.png')
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'blue_robot.blend'))
bpy.ops.render.render(write_still=True)
with open(os.path.join(OUT,'model_stats.json'),'w') as f:json.dump({'mesh_objects':len(parts),'bones':len(bones),'vertices':sum(len(o.data.vertices) for o in parts),'triangles':sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in parts)},f,indent=2)
