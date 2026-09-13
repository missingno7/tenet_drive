import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackManager } from '../src/track.js';
import { PhysicsWorld } from '../src/physics.js';
import { VehicleController, rotationFromAngles } from '../src/vehicle.js';
import { RunManager } from '../src/run.js';
import { terrainSurfaceHeight, WATER_LEVEL } from '../src/surfaces.js';
import { infrastructure } from '../src/infrastructure.js';
import { CAR_PARTS } from '../src/car-parts.js';
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: false }, dt = 1 / 480;
function setup(t) { const track=new TrackManager(),physics=new PhysicsWorld(track,{scenery:false}),player=new VehicleController(0,40,0,track);physics.reset(player,null);t.after(()=>physics.dispose());return {track,physics,player}; }
function step(physics,player,seconds,input=idle){let peak=0,tags=new Set();for(let i=0;i<seconds/dt;i++){const r=physics.step(player,input,dt,null);peak=Math.max(peak,r.impact);r.contacts.forEach(tag=>tags.add(tag));}return{peak,tags};}

test('a tire brushing the edge stays settled, in either direction, without damage',t=>{
 const {physics,player}=setup(t);
 for(const yaw of [0,Math.PI]) for(const side of [-1,1]){
  physics.reset(player,null);physics.teleport(player,{x:side*8.4,y:12.68,z:40},rotationFromAngles(yaw),{x:0,y:0,z:Math.cos(yaw)*12});
  const r=step(physics,player,.65);assert.ok(player.upright>.98);assert.ok(r.peak<3);assert.equal(physics.debris.length,0);assert.ok(player.speed>9);
 }
});

test('one pair of wheels slightly overhanging settles onto the chassis instead of flipping',t=>{
 const {physics,player}=setup(t);physics.teleport(player,{x:9,y:12.68,z:40});step(physics,player,2);
 assert.ok(player.upright>.93);assert.ok(player.position.y>12.25);assert.equal(physics.debris.length,0);
});

test('steering and throttle cannot turn or accelerate an airborne chassis',t=>{
 const {physics,player}=setup(t);physics.teleport(player,{x:0,y:35,z:40},rotationFromAngles(0),{x:0,y:0,z:10});
 step(physics,player,.4,{throttle:1,brake:0,steer:1,handbrake:false});
 assert.ok(Math.abs(player.yaw)<.0001);assert.ok(player.linearVelocity.z<=10);assert.ok(player.linearVelocity.y< -7);
});

test('visible pillars, bases, sign posts and gates all have the exact shared solid bounds',t=>{
 const {track,physics}=setup(t);const objects=infrastructure(track);
 assert.equal(physics.solids.length,objects.length);
 for(const object of objects){const solid=physics.solids.find(s=>s.id===object.id);assert.deepEqual(solid.size,object.size);assert.deepEqual(solid.position,object.position);assert.equal(solid.collider.isSensor(),false);assert.ok(solid.collider.isEnabled());}
 assert.ok(objects.some(s=>s.tag==='sign-post'));assert.ok(objects.some(s=>s.tag==='gate'));
});

test('an airborne car hits a bridge pillar from either side at speed',t=>{
 const {physics,player}=setup(t);
 for(const side of [-1,1]){physics.reset(player,null);physics.teleport(player,{x:side*6,y:6,z:28},rotationFromAngles(0),{x:-side*30,y:0,z:0});
 const r=step(physics,player,.2);assert.ok(r.tags.has('pier'));assert.ok(r.peak>5);assert.ok(side*player.position.x>1);}
});

test('brief water entry can leave the volume without a forced sinking state',t=>{
 const run=new RunManager(new TrackManager());t.after(()=>run.physics.dispose());run.start();
 run.physics.teleport(run.player,{x:20,y:-.7,z:40},rotationFromAngles(0),{x:0,y:9,z:0});
 for(let i=0;i<35;i++)run.step(idle);
 assert.equal(run.status,'playing');assert.equal(run.crash,null);assert.equal(run.physics.submerged,0);assert.equal(run.submergedTime,0);assert.ok(run.player.position.y>0);assert.ok(run.physics.collider.isEnabled());
});

test('crossing from the river onto a bank keeps terrain collision active',t=>{
 const {track,physics,player}=setup(t);
 physics.teleport(player,{x:24,y:-.5,z:40},rotationFromAngles(Math.PI/2),{x:28,y:6,z:0});
 let wet=false,dryAfter=false;
 for(let i=0;i<960;i++){const r=physics.step(player,idle,dt,null);wet ||=r.water;if(wet&&!r.water)dryAfter=true;assert.ok(physics.collider.isEnabled());}
 assert.ok(wet);assert.ok(dryAfter);assert.ok(player.position.y>terrainSurfaceHeight(player.position.x,player.position.z,track)-.25);
});

test('submerged car collides with underwater pillar instead of passing through it',t=>{
 const {physics,player}=setup(t);physics.teleport(player,{x:5,y:-1.8,z:28},rotationFromAngles(0),{x:-22,y:0,z:0});
 const r=step(physics,player,.4);assert.ok(r.tags.has('pier'));assert.ok(player.position.x>1);assert.ok(physics.collider.isEnabled());
});

test('hard collision detaches real car parts that collide with the world and reset cleanly',t=>{
 const {physics,player}=setup(t);physics.teleport(player,{x:7,y:6,z:28},rotationFromAngles(Math.PI/2),{x:-45,y:0,z:0});
 step(physics,player,.2);assert.ok(physics.debris.length>0);assert.ok(physics.debris.length<=CAR_PARTS.length);
 const mass=physics.body.mass()+physics.debris.reduce((sum,p)=>sum+p.body.mass(),0);assert.ok(Math.abs(mass-900)<.01);
 const parts=physics.debris.map(p=>({body:p.body,y:p.body.translation().y}));step(physics,player,.3);
 assert.ok(parts.some(p=>p.body.translation().y<p.y));
 for(const p of physics.debris){assert.ok(p.body.isDynamic());assert.ok(p.body.collider(0).isEnabled());assert.ok(p.body.isCcdEnabled());}
 physics.reset(player,null);assert.equal(physics.debris.length,0);assert.equal(physics.detached.size,0);assert.equal(physics.parts.size,CAR_PARTS.length);assert.ok(Math.abs(physics.body.mass()-900)<.01);
});
