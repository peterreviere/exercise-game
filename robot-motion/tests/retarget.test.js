import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Vector3 } from 'three';
import { RobotRetargeter } from '../src/retarget.js';
async function load(){const b=readFileSync(new URL('../public/robot/blue_robot.glb',import.meta.url));return (await new GLTFLoader().parseAsync(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),'' )).scene;}
test('real exported robot has expected bones and reaches target in world space',async()=>{
 const root=await load();const r=new RobotRetargeter(root);
 assert.equal(r.bind.size,15);
 for(const n of ['chest','upper_armL','forearmL','upper_armR','forearmR','thighL','shinL'])assert.ok(r.bind.has(n),n);
 // Rotate parent first: solving the forearm must still respect its world target.
 r.point('chest',new Vector3(.2,1,0),1);
 r.point('upper_armL',new Vector3(1,.7,0),1);
 const target=new Vector3(.2,1,-.3).normalize();r.point('forearmL',target,1);
 const bone=r.bind.get('forearmL').bone;const hand=bone.children.find(c=>c.isBone);
 const actual=hand.getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3())).normalize();
 assert.ok(actual.dot(target)>.999);
 r.reset();for(const {bone,local}of r.bind.values())assert.ok(bone.quaternion.angleTo(local)<.00001);
});
test('low visibility and lost body data do not create invalid rotations',async()=>{
 const r=new RobotRetargeter(await load());const p=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:0}));
 r.apply(p,.016,true);for(const {bone}of r.bind.values())assert.ok(bone.quaternion.toArray().every(Number.isFinite));
});
test('camera landmark mapping raises the mirrored arm and returns invisible arms to rest',async()=>{
 const r=new RobotRetargeter(await load());
 const p=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:0}));
 p[12]={x:-.2,y:-.4,z:0,visibility:1};p[14]={x:-.4,y:-.7,z:0,visibility:1};p[16]={x:-.45,y:-1,z:0,visibility:1};
 for(let i=0;i<120;i++)r.apply(p,1/60);
 const upper=r.bind.get('upper_armL').bone, fore=r.bind.get('forearmL').bone;
 const direction=fore.getWorldPosition(new Vector3()).sub(upper.getWorldPosition(new Vector3())).normalize();
 assert.ok(direction.x>.4 && direction.y>.7,'mirrored right camera arm should lift robot left arm');
 p.forEach(point=>point.visibility=0);
 for(let i=0;i<120;i++)r.apply(p,1/60);
 assert.ok(upper.quaternion.angleTo(r.bind.get('upper_armL').local)<.001);
});
test('robot greeting wave raises arm and maintains valid finite quaternions',async()=>{
 const r=new RobotRetargeter(await load());
 for(let i=0;i<60;i++) r.wave(1.2, 1/60);
 for(const {bone} of r.bind.values()) {
   assert.ok(bone.quaternion.toArray().every(Number.isFinite));
 }
 const bone=r.bind.get('forearmL').bone;
 const hand=bone.children.find(c=>c.isBone);
 const forearmDir=hand.getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3())).normalize();
 assert.ok(forearmDir.y > 0.5, 'waving forearm should be raised up');
});

