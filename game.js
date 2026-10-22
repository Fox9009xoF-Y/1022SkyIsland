/* 浮島工坊：固定世界、僅繪製外露表面、離線素材與本機遊戲狀態。 */
'use strict';
const $ = s => document.querySelector(s);
if (typeof THREE === 'undefined') {
  $('#play').textContent = 'three.js 載入失敗，請確認 vendor 資料夾';
  throw Error('three.js missing');
}
const N = 32, world = new Uint8Array(N * N * N);
const assets = 'sky-island-assets/sky-island-assets/';
const names = ['空氣', '草地', '泥土', '石頭', '原木', '樹葉', '木板', '沙子', '磚塊', '空手'];
const icons = ['', 'grass', 'dirt', 'stone', 'log', 'leaves', 'planks', 'sand', 'brick'];
const breakTime = [0, 2, 1.8, 3, 2.6, 1.5, 2.4, 1.7, 3];
const inventory = new Uint32Array(9), keys = new Set(), drops = [], slots = [];
const player = {x:16.5, y:14, z:23.5, vy:0, ground:false, crouched:false, peakY:14, health:10};
let yaw = 0, pitch = -.15, selected = 0, hit = null, dig = 0, digKey = '', held = false;
let ready = false, loadFailed = false, playing = false, wasLocked = false;
let lookPointer = null;
const TAU = Math.PI * 2;
let gameTime = 0, nextRegenAt = Infinity, damageFlashUntil = 0, messageUntil = 0;
// E01 排程、E02 水平加減速、E03 跳高、E04 徑向致盲。
const effectKinds = Object.freeze(['blindness','speed','slowness','jumpBoost']);
const effectState = {type:null, endsAt:0, nextAt:Infinity,armed:false,firstPending:true};
let photoDirectory=null,photoCaptureBusy=false,photoSequence=0;
let audioContext=null,audioMuted=false,footstepDistance=0,lastDigSoundAt=-Infinity;
let worldRevision=0;
const monsters=[];const MONSTER_SPEED=4.3*1.1;
let monstersDespawnAt=0,monstersWereBlind=false,monsterNav=null;
let lastSafe = {x:16.5, y:14, z:23.5};
const at = (x,y,z) => x + N * (z + N*y);
const inside = (x,y,z) => x>=0 && z>=0 && y>=0 && x<N && z<N && y<N;
const get = (x,y,z) => inside(x,y,z) ? world[at(x,y,z)] : 0;
const set = (x,y,z,v) => { if (inside(x,y,z)) world[at(x,y,z)] = v; };
const scene = new THREE.Scene();
scene.background = new THREE.Color('#bfe0f4');
scene.fog = new THREE.Fog('#bfe0f4', 30, 65);
const blindnessUniform = {value:0};
function installBlindnessFog(material) {
  material.onBeforeCompile = shader => {
    shader.uniforms.blindnessActive=blindnessUniform;
    shader.vertexShader=shader.vertexShader
      .replace('#include <fog_pars_vertex>', '#include <fog_pars_vertex>\n#ifdef USE_FOG\nvarying vec3 vRadialFogPosition;\n#endif')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n#ifdef USE_FOG\nvRadialFogPosition = mvPosition.xyz;\n#endif');
    const fogFragment=THREE.ShaderChunk.fog_fragment.replaceAll('vFogDepth','fogDistance')
      .replace('#ifdef USE_FOG','#ifdef USE_FOG\nfloat fogDistance = mix( vFogDepth, length(vRadialFogPosition), blindnessActive );');
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <fog_pars_fragment>', '#include <fog_pars_fragment>\n#ifdef USE_FOG\nvarying vec3 vRadialFogPosition;\nuniform float blindnessActive;\n#endif')
      .replace('#include <fog_fragment>',fogFragment);
  };
  material.customProgramCacheKey=()=> 'sky-island-radial-fog-v1';
}
const skyPalette=[[0,0xbfe0f4],[120,0xbfe0f4],[180,0xc5756a],[240,0x101c35],[420,0x101c35],[510,0xdba79b],[600,0xbfe0f4]].map(([t,c])=>({t,color:new THREE.Color(c)}));
const currentSky=new THREE.Color();
function skyColorAt(time,out=new THREE.Color()) {
  const t=((time%600)+600)%600;
  for(let i=1;i<skyPalette.length;i++)if(t<=skyPalette[i].t){const a=skyPalette[i-1],b=skyPalette[i],u=(t-a.t)/(b.t-a.t);return out.copy(a.color).lerp(b.color,u*u*(3-2*u));}
  return out.copy(skyPalette[0].color);
}
function applyEffectVision() {
  const blind=effectState.type==='blindness';
  blindnessUniform.value=blind?1:0;
  skyColorAt(gameTime,currentSky);
  if(blind){scene.background.set(0);scene.fog.color.set(0);}else{scene.background.copy(currentSky);scene.fog.color.copy(currentSky);}
  scene.fog.near=blind?0:30;
  scene.fog.far=blind?3:65;
}
const camera = new THREE.PerspectiveCamera(72, innerWidth/innerHeight, .05, 90);
camera.rotation.order = 'YXZ';
const photoState={enabled:false,flying:true,position:new THREE.Vector3(),vy:0,lastSpaceAt:-Infinity,originalView:null};
let renderer;
try {
  renderer = new THREE.WebGLRenderer({canvas:$('#game'), antialias:false, powerPreference:'low-power'});
} catch (e) {
  $('#play').textContent = '無法啟用 WebGL，請使用支援 3D 的瀏覽器';
  throw e;
}
let quality = false, resolutionScale = 1;
function resize() {
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(resolutionScale * (quality ? Math.min(devicePixelRatio,1.5) : 1));
  renderer.setSize(innerWidth,innerHeight);
}
resize();
const manager = new THREE.LoadingManager();
// 先註冊回呼，避免快取或內嵌材質完成後仍停在停用按鈕。
manager.onLoad = () => {
  if (loadFailed) return;
  ready = true;
  $('#play').disabled = false;
  $('#play').textContent = '開始探索 →';
};
manager.onError = () => {
  loadFailed = true; ready = false;
  $('#play').disabled = true;
  $('#play').textContent = '素材載入失敗，請確認 asset-data.js';
};
const loader = new THREE.TextureLoader(manager), materials = [];
function tex(name) {
  if (!window.BLOCK_TEXTURES?.[name]) { manager.onError(); throw Error('Missing texture: '+name); }
  const t = loader.load(window.BLOCK_TEXTURES[name]);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
['grass_top','grass_side','dirt','stone','log_side','log_top','leaves','planks','sand','brick'].forEach(n => {
  materials.push(new THREE.MeshBasicMaterial({map:tex(n), vertexColors:true}));
});
const cracks = Array.from({length:10},(_,i) => new THREE.MeshBasicMaterial({
  map:tex('destroy_stage_'+i), transparent:true, depthWrite:false, polygonOffset:true, polygonOffsetFactor:-2
}));
const crack = new THREE.Mesh(new THREE.BoxGeometry(1.006,1.006,1.006),cracks[0]);
crack.visible = false; scene.add(crack);
const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.008,1.008,1.008)),new THREE.LineBasicMaterial({color:0x233a30}));
outline.visible = false; scene.add(outline);
materials.forEach(installBlindnessFog);
cracks.forEach(installBlindnessFog);
installBlindnessFog(outline.material);
const faces = [
  {n:[1,0,0],v:[[1,0,1],[1,0,0],[1,1,0],[1,1,1]],shade:.77},
  {n:[-1,0,0],v:[[0,0,0],[0,0,1],[0,1,1],[0,1,0]],shade:.68},
  {n:[0,1,0],v:[[0,1,1],[1,1,1],[1,1,0],[0,1,0]],shade:1},
  {n:[0,-1,0],v:[[0,0,0],[1,0,0],[1,0,1],[0,0,1]],shade:.5},
  {n:[0,0,1],v:[[0,0,1],[1,0,1],[1,1,1],[0,1,1]],shade:.86},
  {n:[0,0,-1],v:[[1,0,0],[0,0,0],[0,1,0],[1,1,0]],shade:.73}
];
const tile = (b,f) => b===1 ? (f===2?0:f===3?2:1) : b===4 ? (f===2||f===3?5:4) : ({2:2,3:3,5:6,6:7,7:8,8:9})[b];
let terrain = null;
function rebuild() {
  worldRevision++;
  const groups = materials.map(() => ({p:[],uv:[],c:[]}));
  for (let y=0;y<N;y++) for (let z=0;z<N;z++) for (let x=0;x<N;x++) {
    const b = get(x,y,z); if (!b) continue;
    faces.forEach((f,i) => {
      if (get(x+f.n[0],y+f.n[1],z+f.n[2])) return;
      const g=groups[tile(b,i)], uv=[[0,0],[1,0],[1,1],[0,1]];
      for (const k of [0,1,2,0,2,3]) {
        g.p.push(x+f.v[k][0],y+f.v[k][1],z+f.v[k][2]);
        g.uv.push(...uv[k]); g.c.push(f.shade,f.shade,f.shade);
      }
    });
  }
  // 使用 TypedArray.set，避免大量方塊時展開陣列超出呼叫參數上限。
  const total = groups.reduce((n,g)=>n+g.p.length,0);
  const p=new Float32Array(total), uv=new Float32Array(total/3*2), c=new Float32Array(total);
  const geo=new THREE.BufferGeometry(); let offset=0;
  groups.forEach((g,i) => {
    geo.addGroup(offset/3,g.p.length/3,i);
    p.set(g.p,offset); c.set(g.c,offset); uv.set(g.uv,offset/3*2); offset+=g.p.length;
  });
  geo.setAttribute('position',new THREE.BufferAttribute(p,3));
  geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));
  geo.setAttribute('color',new THREE.BufferAttribute(c,3)); geo.computeBoundingSphere();
  if (terrain) { scene.remove(terrain); terrain.geometry.dispose(); }
  terrain=new THREE.Mesh(geo,materials); scene.add(terrain);
}
// 掉落物共用方塊幾何與材質，以 InstancedMesh 合批繪製。
const dropGeometry = new THREE.BoxGeometry(.28,.28,.28), dropBatches = [];
for (let type=1;type<=8;type++) {
  const mats=faces.map((_,face)=>materials[tile(type,face)].clone());
  mats.forEach(m=>{m.vertexColors=false;installBlindnessFog(m);});
  const mesh = new THREE.InstancedMesh(dropGeometry,mats,32);
  mesh.count=0; mesh.frustumCulled=false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh); dropBatches[type]=mesh;
}
const placementMaterials=[];
for(let type=1;type<=8;type++) placementMaterials[type]=faces.map((_,i)=>{
  const m=materials[tile(type,i)].clone();m.vertexColors=false;m.transparent=true;m.opacity=.32;m.depthWrite=false;installBlindnessFog(m);return m;
});
const placementPreview=new THREE.Mesh(new THREE.BoxGeometry(.998,.998,.998),placementMaterials[1]);
placementPreview.visible=false;scene.add(placementPreview);
const monsterMaterials=faces.map((_,i)=>{const m=materials[tile(4,i)].clone();m.vertexColors=false;installBlindnessFog(m);return m;});
const monsterMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(.9,1,.9),monsterMaterials,10);
monsterMesh.count=0;monsterMesh.frustumCulled=false;monsterMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);scene.add(monsterMesh);
const monsterDummy=new THREE.Object3D();
function renderMonsters(){monsterMesh.count=0;for(const m of monsters)if(m.placed)for(let h=0;h<2;h++){monsterDummy.position.set(m.x,m.y+h+.5,m.z);monsterDummy.updateMatrix();monsterMesh.setMatrixAt(monsterMesh.count++,monsterDummy.matrix);}monsterMesh.instanceMatrix.needsUpdate=true;}
function resetMonsters(){monsters.length=0;monstersDespawnAt=0;monstersWereBlind=false;monsterNav=null;monsterMesh.count=0;}
function monsterNavigation(){
  const px=Math.max(0,Math.min(31,Math.floor(player.x))),pz=Math.max(0,Math.min(31,Math.floor(player.z))),py=Math.floor(player.y);
  if(monsterNav&&monsterNav.revision===worldRevision&&monsterNav.px===px&&monsterNav.pz===pz&&monsterNav.py===py&&gameTime-monsterNav.time<.25)return monsterNav;
  const heights=new Int16Array(N*N).fill(-1),distance=new Int16Array(N*N).fill(-1);
  for(let z=0;z<N;z++)for(let x=0;x<N;x++){let best=Infinity;for(let y=0;y<N-2;y++)if(get(x,y,z)&&!get(x,y+1,z)&&!get(x,y+2,z)){const delta=Math.abs(y+1-player.y);if(delta<best){heights[x+N*z]=y+1;best=delta;}}}
  let root=px+N*pz;
  if(heights[root]<0){let best=Infinity;root=-1;for(let i=0;i<N*N;i++)if(heights[i]>=0){const d=(i%N+.5-player.x)**2+(Math.floor(i/N)+.5-player.z)**2;if(d<best){best=d;root=i;}}}
  if(root>=0){const queue=new Int16Array(N*N);let front=0,back=0;queue[back++]=root;distance[root]=0;
    while(front<back){const i=queue[front++],x=i%N,z=Math.floor(i/N);for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz,j=nx+N*nz;if(nx<0||nx>=N||nz<0||nz>=N||distance[j]>=0||heights[j]<0||Math.abs(heights[j]-heights[i])>1)continue;distance[j]=distance[i]+1;queue[back++]=j;}}
  }
  monsterNav={heights,distance,revision:worldRevision,px,pz,py,time:gameTime};return monsterNav;
}
function spawnMonsters(){
  resetMonsters();const nav=monsterNavigation(),all=[],far=[];
  for(let i=0;i<N*N;i++)if(nav.distance[i]>=0){all.push(i);if(nav.distance[i]>=4&&nav.distance[i]<=12)far.push(i);}
  const candidates=far.length?far:all;
  for(let id=1;id<=5;id++){const index=candidates.length?candidates.splice(Math.floor(Math.random()*candidates.length),1)[0]:all[0];monsters.push({id,x:index===undefined?0:index%N+.5,y:index===undefined?0:nav.heights[index],z:index===undefined?0:Math.floor(index/N)+.5,placed:index!==undefined,nextAttackAt:gameTime,goal:null});}
  renderMonsters();
}
function syncMonsterLifecycle(previousType,previousEnd){
  if(effectState.type==='blindness'){if(monstersDespawnAt&&gameTime>=monstersDespawnAt)resetMonsters();if(!monsters.length)spawnMonsters();monstersWereBlind=true;monstersDespawnAt=0;}
  else if(monstersWereBlind||previousType==='blindness'){monstersWereBlind=false;monstersDespawnAt=previousEnd+10;}
  if(monstersDespawnAt&&gameTime>=monstersDespawnAt)resetMonsters();
}
function monsterSupported(x,y,z){for(let a=Math.floor(x-.28);a<=Math.floor(x+.28);a++)for(let c=Math.floor(z-.28);c<=Math.floor(z+.28);c++)if(get(a,Math.floor(y-.05),c))return true;return false;}
function monsterGoal(m,nav){
  const x=Math.floor(m.x),z=Math.floor(m.z),i=x+N*z;if(x<0||x>=N||z<0||z>=N||nav.distance[i]<0)return null;
  if(Math.abs(m.x-x-.5)>.001||Math.abs(m.z-z-.5)>.001)return {x:x+.5,z:z+.5,index:i,revision:worldRevision};
  if(nav.distance[i]===0)return {x:player.x,z:player.z,index:i,revision:worldRevision};
  let best=i;for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz,j=nx+N*nz;if(nx>=0&&nx<N&&nz>=0&&nz<N&&nav.distance[j]>=0&&nav.distance[j]<nav.distance[best]&&Math.abs(nav.heights[j]-nav.heights[i])<=1)best=j;}
  return best===i?null:{x:best%N+.5,z:Math.floor(best/N)+.5,index:best,revision:worldRevision};
}
function updateMonsters(dt){
  if(!active()||!ready||photoState.enabled)return;
  if(monstersDespawnAt&&gameTime>=monstersDespawnAt){resetMonsters();return;}
  if(!monsters.length)return;const nav=monsterNavigation();
  for(const m of monsters){if(!m.placed)continue;let budget=MONSTER_SPEED*dt,iterations=0;
    while(budget>1e-8&&iterations++<100){
      if(Math.hypot(m.x-player.x,m.z-player.z)<=1.2)break;
      if(m.goal&&(m.goal.revision!==worldRevision||nav.distance[m.goal.index]<0))m.goal=null;
      if(!m.goal)m.goal=monsterGoal(m,nav);if(!m.goal)break;
      const dx=m.goal.x-m.x,dz=m.goal.z-m.z,d=Math.hypot(dx,dz);if(d<1e-8){m.goal=null;continue;}
      const step=Math.min(.06,budget,d),x=m.x+dx/d*step,z=m.z+dz/d*step;
      let nextY=null;for(const y of [m.y,m.y+1,m.y-1])if(!collides(x,y,z,2)&&monsterSupported(x,y,z)){nextY=y;break;}
      if(nextY===null){m.goal=null;break;}m.x=x;m.y=nextY;m.z=z;budget-=step;if(step>=d-1e-8)m.goal=null;
    }
  }
  renderMonsters();
}
const dummy = new THREE.Object3D();
function renderDrops() {
  const counts = new Uint32Array(9);
  for (const d of drops) counts[d.type]++;
  for (let type=1;type<=8;type++) {
    let mesh=dropBatches[type];
    if (counts[type]>mesh.instanceMatrix.count) {
      const bigger=new THREE.InstancedMesh(dropGeometry,mesh.material,Math.max(counts[type],mesh.instanceMatrix.count*2));
      bigger.frustumCulled=false; bigger.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.remove(mesh); mesh.dispose(); scene.add(bigger); dropBatches[type]=mesh=bigger;
    }
    mesh.count=0;
  }
  for (const d of drops) {
    const mesh=dropBatches[d.type];
    dummy.position.set(d.x,d.y,d.z); dummy.rotation.set(0,gameTime*.8+d.phase,0); dummy.updateMatrix();
    mesh.setMatrixAt(mesh.count++,dummy.matrix);
  }
  for (let type=1;type<=8;type++) dropBatches[type].instanceMatrix.needsUpdate=true;
}
function spawnDrop(type,count,x,y,z,delay=.35) {
  if (!count || type<1 || type>8) return;
  // 同一格、同一種類合併成一疊；count 保留所有物品數量。
  const existing=drops.find(d=>d.type===type&&Math.floor(d.x)===Math.floor(x)&&Math.floor(d.y)===Math.floor(y)&&Math.floor(d.z)===Math.floor(z));
  if (existing) { existing.count+=count; existing.pickupAt=Math.max(existing.pickupAt,gameTime+delay); return; }
  drops.push({type,count,x,y,z,vy:0,phase:Math.random()*6,pickupAt:gameTime+delay});
}
function clearDrops() { drops.length=0; renderDrops(); }
function canPickup(d) {
  return Math.abs(Math.floor(player.x)-Math.floor(d.x))<=1 &&
    Math.abs(Math.floor(player.z)-Math.floor(d.z))<=1 && Math.abs(player.y-d.y)<=1.25;
}
function updateDrops(dt) {
  let changed=false;
  for (let i=drops.length-1;i>=0;i--) {
    const d=drops[i]; d.vy-=20*dt;
    const dy=d.vy*dt, steps=Math.max(1,Math.ceil(Math.abs(dy)/.1));
    for (let s=0;s<steps;s++) {
      const next=d.y+dy/steps;
      if (next<.16) { d.y=.16; d.vy=0; break; }
      if (get(Math.floor(d.x),Math.floor(next-.14),Math.floor(d.z))) {
        d.y=Math.floor(next-.14)+1.14; d.vy=0; break;
      }
      d.y=next;
    }
    if (gameTime>=d.pickupAt && canPickup(d)) {
      inventory[d.type]+=d.count; changed=true; drops.splice(i,1);
    }
  }
  if (changed) updateInventory();
  renderDrops();
}
function collides(x,y,z,h) {
  for(let a=Math.floor(x-.28);a<=Math.floor(x+.28);a++)
    for(let b=Math.floor(y+.00001);b<=Math.floor(y+h-.00001);b++)
      for(let c=Math.floor(z-.28);c<=Math.floor(z+.28);c++) if(get(a,b,c)) return true;
  return false;
}
const SAVE_KEY='sky-island-worlds-v1';
let saveSequence=0;
function captureWorld() {
  return {schema:'sky-island',version:2,size:N,blocks:Array.from(world),bag:Array.from(inventory),
    player:{...player},view:photoState.enabled?{...photoState.originalView}:{yaw,pitch},time:gameTime,regenAt:Number.isFinite(nextRegenAt)?nextRegenAt:null,
    effect:{...effectState,nextAt:Number.isFinite(effectState.nextAt)?effectState.nextAt:null},drops:drops.map(d=>({...d})),lastSafe:{...lastSafe},selected};
}
function validateWorld(data) {
  const finite=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
  const integer=(n,min,max)=>Number.isInteger(n)&&finite(n,min,max);
  const point=p=>p&&finite(p.x,-128,128)&&finite(p.y,-16,128)&&finite(p.z,-128,128);
  if(!data||data.schema!=='sky-island'||![1,2].includes(data.version)||data.size!==N)throw Error('不支援的世界格式或版本');
  if(!Array.isArray(data.blocks)||data.blocks.length!==N*N*N||!data.blocks.every(n=>integer(n,0,8)))throw Error('方塊資料不正確');
  if(!Array.isArray(data.bag)||data.bag.length!==9||!data.bag.every(n=>integer(n,0,1000000000)))throw Error('物品欄資料不正確');
  if(!point(data.player)||!integer(data.player.health,1,10)||!finite(data.player.vy,-10000,10000)||!finite(data.player.peakY,-16,128)||typeof data.player.ground!=='boolean'||typeof data.player.crouched!=='boolean')throw Error('玩家資料不正確');
  if(!data.view||!finite(data.view.yaw,-Math.PI,Math.PI)||!finite(data.view.pitch,-1.55,1.55)||!finite(data.time,0,1e9)||!integer(data.selected,0,8)||!point(data.lastSafe))throw Error('視角或時間不正確');
  if(data.regenAt!==null&&!finite(data.regenAt,0,1e9))throw Error('回血時間不正確');
  if(!data.effect||!(data.effect.type===null||effectKinds.includes(data.effect.type))||!finite(data.effect.endsAt,0,1e9)||!(finite(data.effect.nextAt,0,1e9)||(data.version===2&&data.effect.nextAt===null)))throw Error('效果資料不正確');
  if(data.version===2&&(typeof data.effect.armed!=='boolean'||typeof data.effect.firstPending!=='boolean'))throw Error('首次效果資料不正確');
  const effect=data.version===1?{type:data.effect.type,endsAt:data.effect.type?data.time+60:0,nextAt:data.time+70,armed:true,firstPending:false}:{type:data.effect.type,endsAt:data.effect.endsAt,nextAt:data.effect.nextAt,armed:data.effect.armed,firstPending:data.effect.firstPending};
  if(!Array.isArray(data.drops)||data.drops.length>32768||!data.drops.every(d=>point(d)&&integer(d.type,1,8)&&integer(d.count,1,1e9)&&finite(d.vy,-10000,10000)&&finite(d.phase,0,100)&&finite(d.pickupAt,0,1e9)))throw Error('掉落物資料不正確');
  const h=data.player.crouched?1.45:1.8;
  for(let x=Math.floor(data.player.x-.28);x<=Math.floor(data.player.x+.28);x++)
    for(let y=Math.floor(data.player.y+.00001);y<=Math.floor(data.player.y+h-.00001);y++)
      for(let z=Math.floor(data.player.z-.28);z<=Math.floor(data.player.z+.28);z++)
        if(inside(x,y,z)&&data.blocks[at(x,y,z)])throw Error('玩家位置位於實心方塊內');
  const copyPoint=p=>({x:p.x,y:p.y,z:p.z});
  return {schema:'sky-island',version:2,size:N,blocks:data.blocks.slice(),bag:data.bag.slice(),
    player:{...copyPoint(data.player),health:data.player.health,vy:data.player.vy,peakY:data.player.peakY,ground:data.player.ground,crouched:data.player.crouched},
    view:{yaw:data.view.yaw,pitch:data.view.pitch},time:data.time,regenAt:data.regenAt,selected:data.selected,lastSafe:copyPoint(data.lastSafe),
    effect,
    drops:data.drops.map(d=>({...copyPoint(d),type:d.type,count:d.count,vy:d.vy,phase:d.phase,pickupAt:d.pickupAt}))};
}
function restoreWorld(input) {
  const data=validateWorld(input); // 驗證完成前不碰現有世界。
  if(photoState.enabled)togglePhotoMode();
  pause();world.set(data.blocks);inventory.set(data.bag);Object.assign(player,data.player);
  yaw=data.view.yaw;pitch=data.view.pitch;gameTime=data.time;nextRegenAt=data.regenAt===null?Infinity:data.regenAt;
  Object.assign(effectState,data.effect);effectState.nextAt=data.effect.nextAt===null?Infinity:data.effect.nextAt;lastSafe={...data.lastSafe};selected=data.selected;
  clearDrops();data.drops.forEach(d=>drops.push({...d}));renderDrops();rebuild();resetDig();
  damageFlashUntil=0;messageUntil=0;$('#notice').textContent='';applyEffectVision();updateEffectLabel();updateInventory();updateHealth();updateCamera();
}
function storageFor(store){return store||window.localStorage;}
function listSavedWorlds(store) {
  const raw=storageFor(store).getItem(SAVE_KEY);if(raw===null)return [];
  if(raw.length>15000000)throw Error('保存資料過大');
  const list=JSON.parse(raw);
  if(!Array.isArray(list)||list.length>20||!list.every(e=>e&&typeof e.id==='string'&&typeof e.name==='string'&&e.name.length<=48&&e.data))throw Error('保存清單損壞');
  return list;
}
function cleanSaveName(name){if(typeof name!=='string'||!name.trim()||name.trim().length>48)throw Error('世界名稱請填寫 1～48 字');return name.trim();}
function storeEntry(name,data,store) {
  const list=listSavedWorlds(store);if(list.length>=20)throw Error('最多保存 20 個世界，請先匯出備份');
  const id='world-'+Date.now().toString(36)+'-'+(++saveSequence);
  list.push({id,name:cleanSaveName(name),savedAt:Date.now(),data:validateWorld(data)});
  storageFor(store).setItem(SAVE_KEY,JSON.stringify(list));return id;
}
function saveWorld(name,store){return storeEntry(name,captureWorld(),store);}
function savedEntry(id,store){const entry=listSavedWorlds(store).find(e=>e.id===id);if(!entry)throw Error('請先選擇保存的世界');return entry;}
function loadSavedWorld(id,store){restoreWorld(savedEntry(id,store).data);}
function renameSavedWorld(id,name,store){const list=listSavedWorlds(store),entry=list.find(e=>e.id===id);if(!entry)throw Error('找不到存檔');entry.name=cleanSaveName(name);storageFor(store).setItem(SAVE_KEY,JSON.stringify(list));}
function exportSavedWorld(id,store){const e=savedEntry(id,store);return JSON.stringify({format:'sky-island-backup',version:1,name:e.name,data:validateWorld(e.data)});}
function importSavedWorld(text,store){if(typeof text!=='string'||text.length>2000000)throw Error('備份檔超過 2 MB');const b=JSON.parse(text);if(b.format!=='sky-island-backup'||b.version!==1)throw Error('不支援的備份');return storeEntry(b.name,b.data,store);}
function downloadBlob(blob,filename){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function refreshSaveList(selectedId) {
  const select=$('#save-list');select.innerHTML='';
  for(const entry of listSavedWorlds()){const option=document.createElement('option');option.value=entry.id;option.textContent=entry.name;select.append(option);}
  if(selectedId)select.value=selectedId;
}
function saveAction(action){try{action();$('#save-status').textContent='完成';}catch(e){$('#save-status').textContent='未完成：'+e.message;}}
function soundProfile(type,action) {
  const frequency=[0,115,95,230,155,410,185,125,270][type]||115;
  return {frequency:frequency*(action==='place'?.8:action==='step'?.6:1),duration:action==='step'?.045:action==='place'?.12:.09,wave:type===3||type===8?'square':type===5?'triangle':'sawtooth'};
}
function unlockAudio() {
  try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return false;if(!audioContext)audioContext=new Audio();if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});return true;}catch{return false;}
}
function playBlockSound(type,action) {
  if(audioMuted||!audioContext||audioContext.state!=='running')return false;
  try{const p=soundProfile(type,action),osc=audioContext.createOscillator(),gain=audioContext.createGain(),now=audioContext.currentTime;
    osc.type=p.wave;osc.frequency.setValueAtTime(p.frequency,now);osc.frequency.exponentialRampToValueAtTime(p.frequency*.45,now+p.duration);
    gain.gain.setValueAtTime(.025,now);gain.gain.exponentialRampToValueAtTime(.0001,now+p.duration);
    osc.connect(gain);gain.connect(audioContext.destination);osc.start(now);osc.stop(now+p.duration);osc.onended=()=>{osc.disconnect();gain.disconnect();};return true;
  }catch{return false;}
}
function resetEffects() {
  resetMonsters();
  Object.assign(effectState,{type:null,endsAt:0,nextAt:Infinity,armed:false,firstPending:true});
  applyEffectVision();updateEffectLabel();
}
function armFirstEffect(){if(!effectState.armed){effectState.armed=true;effectState.nextAt=gameTime+10;}}
function chooseEffect(random=Math.random()){return random<.4?'blindness':random<.6?'speed':random<.8?'slowness':'jumpBoost';}
function updateEffects() {
  if(!active()||!ready)return;
  const previousType=effectState.type,previousEnd=effectState.endsAt;
  if(effectState.type!==null&&gameTime>=effectState.endsAt){effectState.type=null;effectState.endsAt=0;}
  if(effectState.armed&&gameTime>=effectState.nextAt){
    effectState.type=effectState.firstPending?'blindness':chooseEffect();
    effectState.firstPending=false;effectState.endsAt=gameTime+60;
    effectState.nextAt=gameTime+70+Math.random()*30;
  }
  syncMonsterLifecycle(previousType,previousEnd);
  applyEffectVision();updateEffectLabel();
}
function generate() {
  if(photoState.enabled)togglePhotoMode();
  world.fill(0); clearDrops(); inventory.fill(0); gameTime=0; nextRegenAt=Infinity;
  resetEffects();
  player.health=10; player.crouched=false;
  const phase=Math.random()*100;
  for(let z=2;z<30;z++) for(let x=2;x<30;x++) {
    const r=Math.hypot((x-15.5)/14,(z-15.5)/14);
    if(r>1+Math.sin(x*2+z)*.035) continue;
    const top=9+Math.floor(Math.sin(x*.26+phase)*1.2+Math.cos(z*.3+phase)*1.2),bottom=Math.max(1,Math.floor(2+r*4));
    for(let y=bottom;y<=top;y++) set(x,y,z,y===top?1:y===top-1?(Math.random()<.5?7:3):[7,3,1][Math.floor(Math.random()*3)]);
  }
  for(let z=6;z<27;z+=6) for(let x=6;x<27;x+=6) {
    if(Math.random()<.22) continue;
    let y=31; while(y>0&&!get(x,y,z)) y--; if(!y) continue;
    for(let h=1;h<=4;h++) set(x,y+h,z,4);
    for(let dx=-2;dx<=2;dx++) for(let dz=-2;dz<=2;dz++) for(let dy=3;dy<=5;dy++)
      if(Math.abs(dx)+Math.abs(dz)<4&&!get(x+dx,y+dy,z+dz)) set(x+dx,y+dy,z+dz,5);
  }
  rebuild(); respawn(); resetDig(); hit=null;
  damageFlashUntil=0; messageUntil=0; $('#notice').textContent=''; $('#damage-flash').classList.remove('visible');
  updateInventory(); updateHealth(); updateCamera();
}
function respawn() {
  const spots=[];
  for(let z=0;z<N;z++) for(let x=0;x<N;x++) {
    let y=N-3; while(y>=0&&!get(x,y,z)) y--;
    if(y>=0&&!collides(x+.5,y+1,z+.5,1.8)) spots.push({x:x+.5,y:y+1,z:z+.5});
  }
  // 全部方塊被挖光時仍提供一個可站立的復活點。
  if(!spots.length) { set(16,7,16,1); rebuild(); spots.push({x:16.5,y:8,z:16.5}); }
  const alternatives=spots.filter(s=>Math.floor(s.x)!==Math.floor(player.x)||Math.floor(s.z)!==Math.floor(player.z));
  const pool=alternatives.length?alternatives:spots, spot=pool[Math.floor(Math.random()*pool.length)];
  Object.assign(player,spot,{vy:0,ground:true,crouched:false,peakY:spot.y});
  lastSafe={...spot}; keys.clear(); resetDig(); updateCamera();
}
function updateHealth() {
  $('#hearts').innerHTML=Array.from({length:10},(_,i)=>'<span class="heart '+(i<player.health?'full':'empty')+'" aria-hidden="true">♥</span>').join('');
  $('#hearts').setAttribute('aria-label','生命值 '+player.health+' / 10 顆心');
}
function notify(message) { $('#notice').textContent=message; messageUntil=gameTime+4; }
function fallDamage(distance) {
  const blocks=Math.floor(distance+.0001);
  return blocks<4?0:blocks===4?2:Math.min(10,blocks);
}
function die(voidFall=false) {
  const anchor=voidFall?lastSafe:{x:player.x,y:player.y,z:player.z};
  const directions=[[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
  for(let type=1;type<=8;type++) {
    if(!inventory[type]) continue;
    const candidates=[];
    for(const dir of directions) for(const radius of [1,2]) {
      const x=Math.floor(anchor.x)+.5+dir[0]*radius,z=Math.floor(anchor.z)+.5+dir[1]*radius;
      if(x>=.5&&x<N&&z>=.5&&z<N) candidates.push({x,z});
    }
    const {x,z}=candidates[Math.floor(Math.random()*candidates.length)];
    let y=Math.max(.2,Math.min(N-.2,anchor.y+.2));
    // 若散落位置位於方塊內，將物品放到同一柱最近的上方空間。
    while(y<N-.2&&get(Math.floor(x),Math.floor(y),Math.floor(z))) y=Math.min(N-.2,Math.floor(y)+1.2);
    spawnDrop(type,inventory[type],x,y,z,1);
  }
  inventory.fill(0); player.health=10; nextRegenAt=Infinity;
  respawn(); updateInventory(); updateHealth();
  notify(voidFall?'墜入虛空，已復活；物品散落在最後落腳處附近。':'你已復活，物品散落在死亡位置附近。');
}
function damage(amount) {
  if(amount<=0) return;
  player.health=Math.max(0,player.health-amount);
  nextRegenAt=gameTime+21.5; damageFlashUntil=gameTime+.3;
  if(player.health===0) die();
  else { updateHealth(); notify('墜落受傷：−'+amount+' 顆心'); }
}
function updateHealthClock(dt) {
  gameTime+=dt;
  while(player.health<10&&gameTime+1e-9>=nextRegenAt) {
    player.health++; nextRegenAt+=1.5; updateHealth();
  }
  if(player.health===10) nextRegenAt=Infinity;
  $('#damage-flash').classList.toggle('visible',gameTime<damageFlashUntil);
  if(messageUntil&&gameTime>messageUntil) { $('#notice').textContent=''; messageUntil=0; }
}
function updateCamera() {
  if(photoState.enabled){camera.position.copy(photoState.position);camera.rotation.set(pitch,yaw,0);return;}
  camera.position.set(player.x,player.y+(player.crouched?1.25:1.62),player.z);
  camera.rotation.set(pitch,yaw,0);
}
function move(dt) {
  const beforeX=player.x,beforeZ=player.z;
  // 起身時確認頭頂空間，避免在低矮通道中穿入方塊。
  player.crouched=keys.has('ControlLeft')||collides(player.x,player.y,player.z,1.8);
  const crouch=player.crouched,h=crouch?1.45:1.8;
  const forward=Number(keys.has('KeyW'))-Number(keys.has('KeyS')),side=Number(keys.has('KeyD'))-Number(keys.has('KeyA'));
  const len=Math.hypot(forward,side)||1;
  const sprint=!crouch&&keys.has('ShiftLeft')&&forward>0;
  const baseSpeed=crouch?1.7:sprint?6.5:4.3;
  const speedMultiplier=effectState.type==='speed'?1.5:effectState.type==='slowness'?.5:1;
  const speed=baseSpeed*speedMultiplier;
  const dx=(side*Math.cos(yaw)-forward*Math.sin(yaw))/len*speed*dt,dz=(-forward*Math.cos(yaw)-side*Math.sin(yaw))/len*speed*dt;
  for(const [axis,d] of [['x',dx],['z',dz]]) {
    const x=player.x+(axis==='x'?d:0),z=player.z+(axis==='z'?d:0);
    if(!collides(x,player.y,z,h)&&!(crouch&&player.ground&&!collides(x,player.y-.12,z,h))) player[axis]+=d;
  }
  if(keys.has('Space')&&player.ground&&!crouch) {
    // 在相同重力下，額外三格高度需要增加動能，不是將初速加三。
    player.vy=effectState.type==='jumpBoost'?Math.sqrt(7*7+2*20*3):7;
    player.ground=false; player.peakY=player.y;
  }
  player.vy-=20*dt;
  const dy=player.vy*dt,steps=Math.max(1,Math.ceil(Math.abs(dy)/.08));
  player.ground=false;
  for(let i=0;i<steps;i++) {
    const next=player.y+dy/steps;
    if(!collides(player.x,next,player.z,h)) player.y=next;
    else {
      if(dy<0) {
        player.y=Math.ceil(next); player.ground=true;
        const amount=fallDamage(player.peakY-player.y);
        player.peakY=player.y; player.vy=0;
        lastSafe={x:player.x,y:player.y,z:player.z};
        damage(amount);
      } else { player.y=Math.floor(next+h)-h; player.vy=0; }
      break;
    }
  }
  player.peakY=Math.max(player.peakY,player.y);
  if(player.ground) { player.peakY=player.y; lastSafe={x:player.x,y:player.y,z:player.z}; }
  if(player.y< -12) die(true);
  const walked=Math.hypot(player.x-beforeX,player.z-beforeZ);
  if(player.ground&&walked>0&&walked<1.5){footstepDistance+=walked;if(footstepDistance>=.6){footstepDistance%=.6;playBlockSound(get(Math.floor(player.x),Math.floor(player.y-.05),Math.floor(player.z))||1,'step');}}
  updateCamera();
}
const ray=new THREE.Raycaster(); ray.far=5;
function target() {
  camera.updateMatrixWorld(); terrain.updateMatrixWorld();
  ray.setFromCamera(new THREE.Vector2(0,0),camera);
  const result=ray.intersectObject(terrain)[0]; if(!result) return null;
  const p=result.point.clone().addScaledVector(result.face.normal,-.001);
  return {x:Math.floor(p.x),y:Math.floor(p.y),z:Math.floor(p.z),n:result.face.normal,distance:result.distance};
}
function resetDig() { lastDigSoundAt=-Infinity; held=false; dig=0; digKey=''; crack.visible=false; }
function updateInventory() {
  slots.forEach((b,i)=>{
    b.classList.toggle('active',selected===i);
    b.setAttribute('aria-pressed',String(selected===i));
    b.setAttribute('aria-label',(i+1)+' '+names[i+1]+(i<8?'，數量 '+inventory[i+1]:''));
    if(i<8) b.querySelector('.count').textContent=inventory[i+1];
  });
  $('#selected').textContent=names[selected+1]+' · '+(selected===8?'徒手挖掘':inventory[selected+1]+' 個');
}
function select(i) { selected=((i%9)+9)%9; updateInventory(); }
for(let i=0;i<9;i++) {
  const b=document.createElement('button'); b.className='slot'; b.title=names[i+1];
  b.innerHTML='<span class="key-number">'+(i+1)+'</span>'+(i<8?'<img draggable="false" src="'+assets+'icons/'+icons[i+1]+'.png" alt=""><b class="count">0</b>':'<em>空手</em>');
  b.onclick=()=>select(i); $('#hotbar').append(b); slots.push(b);
}
function placementCell(t) {
  if(photoState.enabled)return null;
  if(!t||t.distance>5||selected>=8||!inventory[selected+1]) return null;
  const x=t.x+t.n.x,y=t.y+t.n.y,z=t.z+t.n.z,h=player.crouched?1.45:1.8;
  if(!inside(x,y,z)||get(x,y,z)) return null;
  if(x+1>player.x-.28&&x<player.x+.28&&z+1>player.z-.28&&z<player.z+.28&&y+1>player.y+.00001&&y<player.y+h-.00001) return null;
  return {x,y,z};
}
function updatePlacementPreview(t) {
  const cell=active()?placementCell(t):null;
  placementPreview.visible=!!cell;
  if(cell){placementPreview.position.set(cell.x+.5,cell.y+.5,cell.z+.5);placementPreview.material=placementMaterials[selected+1];}
}
function updateEffectLabel() {
  const labels={blindness:'致盲',speed:'加速',slowness:'減速',jumpBoost:'跳躍提升'};
  const seconds=Math.max(0,Math.ceil(effectState.endsAt-gameTime));
  $('#effect-label').textContent=effectState.type&&seconds?labels[effectState.type]+' · '+seconds+' 秒':'';
}
function placeBlock(t) {
  if(photoState.enabled)return false;
  if(!t||t.distance>5||selected>=8) return false;
  const type=selected+1;
  if(!inventory[type]) { notify('沒有'+names[type]+'，先挖掘並撿拾方塊。'); return false; }
  const cell=placementCell(t);if(!cell)return false;
  const {x,y,z}=cell;
  set(x,y,z,type);
  if(collides(player.x,player.y,player.z,player.crouched?1.45:1.8)) { set(x,y,z,0); return false; }
  inventory[type]--; rebuild(); updateInventory(); playBlockSound(type,'place'); return true;
}
function updateMining(dt) {
  if(photoState.enabled){resetDig();outline.visible=false;return;}
  hit=target(); updatePlacementPreview(hit); outline.visible=!!hit; crack.visible=false;
  if(!hit) { $('#target').textContent=''; dig=0; digKey=''; return; }
  const type=get(hit.x,hit.y,hit.z), duration=breakTime[type];
  outline.position.set(hit.x+.5,hit.y+.5,hit.z+.5);
  const key=[hit.x,hit.y,hit.z].join(',');
  if(key!==digKey) { dig=0; digKey=key; }
  if(held) {
    if(gameTime-lastDigSoundAt>=.18){playBlockSound(type,'dig');lastDigSoundAt=gameTime;}
    dig+=dt; crack.visible=true; crack.position.copy(outline.position);
    crack.material=cracks[Math.min(9,Math.floor(dig/duration*10))];
    $('#target').textContent=names[type]+' · 挖掘 '+Math.min(100,Math.floor(dig/duration*100))+'%';
    if(dig+1e-9>=duration) {
      set(hit.x,hit.y,hit.z,0);
      armFirstEffect();
      spawnDrop(type,1,hit.x+.5,hit.y+.2,hit.z+.5);
      rebuild(); dig=0; digKey=''; crack.visible=false;
    }
  } else { dig=0; $('#target').textContent=names[type]+' · '+duration.toFixed(1)+' 秒'; }
}
const locked=()=>document.pointerLockElement===$('#game');
const active=()=>playing;
function showLookHint() {
  $('footer p').textContent='WASD 移動 · 左 Ctrl 蹲下 · 左 Shift＋W 奔跑 · 左鍵挖掘 · 右鍵放置'+(locked()?'':' · 相容轉向：移至左右邊緣持續旋轉，移回中央停止');
}
function pause() {
  playing=false; placementPreview.visible=false; lookPointer=null; resetDig(); keys.clear();
  document.body.classList.remove('playing');
  if(locked()) document.exitPointerLock?.();
  $('#overlay').classList.remove('hidden');
  try{refreshSaveList();}catch(e){$('#save-status').textContent='無法讀取本機存檔：'+e.message;}
}
$('#play').onclick=()=>{
  if(!ready) return;
  unlockAudio();
  playing=true; lookPointer=null; resetDig(); keys.clear(); $('#overlay').classList.add('hidden');
  document.body.classList.add('playing'); $('#play').textContent='繼續探索 →'; showLookHint();
  try { const request=$('#game').requestPointerLock?.(); if(request&&typeof request.catch==='function') request.catch(showLookHint); }
  catch { showLookHint(); }
};
$('#pause').onclick=pause;
document.addEventListener('pointerlockchange',()=>{
  const nowLocked=locked();
  lookPointer=null;
  if(nowLocked&&!playing) { document.exitPointerLock?.(); return; }
  if(wasLocked&&!nowLocked) pause(); wasLocked=nowLocked; showLookHint();
});
document.addEventListener('pointerlockerror',showLookHint);
window.addEventListener('keydown',e=>{
  if(active()&&['Space','ArrowUp','ArrowDown','ControlLeft','ShiftLeft'].includes(e.code)) e.preventDefault();
  if(e.code==='Escape') pause();
  if(active()&&handlePhotoKey(e))return;
  if(active()) { keys.add(e.code); if(/^Digit[1-9]$/.test(e.code)) select(+e.code.slice(-1)-1); }
});
window.addEventListener('keyup',e=>keys.delete(e.code)); window.addEventListener('blur',pause);
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
async function resolvePhotoDirectory() {
  if(photoDirectory)return photoDirectory;
  if(typeof window.showDirectoryPicker!=='function')return null;
  const parent=await window.showDirectoryPicker({id:'mcgame-photos',mode:'readwrite'});
  photoDirectory=parent.name==='photosave'?parent:await parent.getDirectoryHandle('photosave',{create:true});
  return photoDirectory;
}
async function capturePhoto() {
  if(!photoState.enabled||photoCaptureBusy)return false;
  photoCaptureBusy=true;
  const filename='sky-island-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+(++photoSequence)+'.png';
  $('#photo-status').textContent='正在拍照…';
  try{
    let directory=null;
    try{directory=await resolvePhotoDirectory();}catch(e){if(e.name==='AbortError'){$('#photo-status').textContent='已取消儲存位置選擇';return {method:'cancelled'};}photoDirectory=null;}
    updateCamera();outline.visible=crack.visible=placementPreview.visible=false;renderer.render(scene,camera);
    const blob=await new Promise((resolve,reject)=>$('#game').toBlob(b=>b?resolve(b):reject(Error('無法建立 PNG')),'image/png'));
    if(directory){try{const file=await directory.getFileHandle(filename,{create:true});const stream=await file.createWritable();await stream.write(blob);await stream.close();$('#photo-status').textContent='已保存至 photosave / '+filename;return {method:'folder',filename};}catch{photoDirectory=null;}}
    downloadBlob(blob,filename);$('#photo-status').textContent='已下載 PNG；請手動移入 mcgame/photosave';return {method:'download',filename};
  }catch(e){$('#photo-status').textContent='拍照未完成：'+e.message;return false;}finally{photoCaptureBusy=false;}
}
function togglePhotoMode() {
  if(!photoState.enabled){
    if(!active()||!ready)return false;updateCamera();photoState.position.copy(camera.position);
    photoState.originalView={yaw,pitch};photoState.enabled=true;photoState.flying=true;photoState.vy=0;photoState.lastSpaceAt=-Infinity;
    document.body.classList.add('photo-mode');
  }else{photoState.enabled=false;yaw=photoState.originalView.yaw;pitch=photoState.originalView.pitch;document.body.classList.remove('photo-mode');}
  keys.clear();resetDig();outline.visible=placementPreview.visible=false;updateCamera();return true;
}
function handlePhotoKey(e) {
  if(e.code==='KeyP'){e.preventDefault();if(!e.repeat)togglePhotoMode();return true;}
  if(!photoState.enabled)return false;
  if(e.code==='KeyO'){e.preventDefault();if(!e.repeat&&typeof capturePhoto==='function')void capturePhoto();return true;}
  if(e.code==='Space'&&!e.repeat){const time=Number.isFinite(e.timeStamp)?e.timeStamp:performance.now();if(time-photoState.lastSpaceAt<300){photoState.flying=false;photoState.vy=-12;keys.delete('Space');photoState.lastSpaceAt=-Infinity;return true;}photoState.lastSpaceAt=time;}
  return false;
}
function movePhoto(dt) {
  const forward=Number(keys.has('KeyW'))-Number(keys.has('KeyS')),side=Number(keys.has('KeyD'))-Number(keys.has('KeyA'));
  const len=Math.hypot(forward,side)||1,speed=6;
  photoState.position.x+=(side*Math.cos(yaw)-forward*Math.sin(yaw))/len*speed*dt;
  photoState.position.z+=(-forward*Math.cos(yaw)-side*Math.sin(yaw))/len*speed*dt;
  if(photoState.flying){photoState.position.y+=(Number(keys.has('Space'))-Number(keys.has('ControlLeft')))*speed*dt;}
  else{
    photoState.vy-=30*dt;const dy=photoState.vy*dt,steps=Math.max(1,Math.ceil(Math.abs(dy)/.08));
    for(let i=0;i<steps;i++){const y=photoState.position.y+dy/steps,feet=y-1.62;
      if(feet<.2){photoState.position.y=1.82;photoState.vy=0;break;}
      if(get(Math.floor(photoState.position.x),Math.floor(feet),Math.floor(photoState.position.z))){photoState.position.y=Math.floor(feet)+2.62;photoState.vy=0;break;}
      photoState.position.y=y;
    }
  }
  updateCamera();
}
function rotateView(horizontal,vertical) {
  // 水平角度循環正規化，避免長時間旋轉累積誤差；只限制上下俯仰。
  if(Number.isFinite(horizontal)) yaw=((yaw-horizontal+Math.PI)%TAU+TAU)%TAU-Math.PI;
  if(Number.isFinite(vertical)) pitch=Math.max(-1.55,Math.min(1.55,pitch-vertical));
}
function trackLook(e) {
  if(!active()) return;
  if(locked()) { rotateView((e.movementX||0)*.002,(e.movementY||0)*.002); return; }
  const hasPosition=Number.isFinite(e.clientX)&&Number.isFinite(e.clientY);
  // 部分內嵌瀏覽器不提供 movementX/Y，未鎖定時由 client 座標求差。
  const dx=hasPosition&&lookPointer?e.clientX-lookPointer.x:(e.movementX||0);
  const dy=hasPosition&&lookPointer?e.clientY-lookPointer.y:(e.movementY||0);
  rotateView(dx*.002,dy*.002);
  if(hasPosition) lookPointer={x:e.clientX,y:e.clientY};
}
function updateLook(dt) {
  if(!active()||locked()||!lookPointer) return;
  const edge=Math.min(64,innerWidth*.1);
  const x=Math.max(0,Math.min(innerWidth,lookPointer.x));
  const turn=x<edge?-(edge-x)/edge:x>innerWidth-edge?(x-(innerWidth-edge))/edge:0;
  // 邊緣持續轉向不依賴新的 mousemove 事件，游標到邊界也可連續轉過 360 度。
  rotateView(turn*2.4*dt,0);
}
document.addEventListener('mousemove',trackLook);
window.addEventListener('wheel',e=>{
  if(active()) { e.preventDefault(); select(selected+(e.deltaY>0?1:-1)); }
},{passive:false});
$('#game').addEventListener('contextmenu',e=>e.preventDefault());
$('#game').addEventListener('mousedown',e=>{
  if(!active()||photoState.enabled) return;
  if(e.button===0) held=true;
  if(e.button===2) { e.preventDefault(); placeBlock(target()); }
});
window.addEventListener('mouseup',e=>{if(e.button===0)resetDig();});
$('#new').onclick=()=>{ generate(); $('#play').textContent='探索新島嶼 →'; };
$('#fullscreen').onclick=async()=>{
  try { if(document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { $('#fullscreen').textContent='請使用瀏覽器 F11'; }
};
$('#sound-toggle').onclick=()=>{audioMuted=!audioMuted;if(!audioMuted)unlockAudio();$('#sound-toggle').textContent='音效：'+(audioMuted?'關':'開');};
$('#save-world').onclick=()=>saveAction(()=>{const id=saveWorld($('#world-name').value);refreshSaveList(id);});
$('#load-world').onclick=()=>saveAction(()=>loadSavedWorld($('#save-list').value));
$('#rename-world').onclick=()=>saveAction(()=>{const id=$('#save-list').value;renameSavedWorld(id,$('#world-name').value);refreshSaveList(id);});
$('#export-world').onclick=()=>saveAction(()=>downloadBlob(new Blob([exportSavedWorld($('#save-list').value)],{type:'application/json'}),'sky-island-backup.json'));
$('#import-world').onclick=()=>$('#import-file').click();
$('#import-file').onchange=async e=>{const file=e.target.files?.[0];if(!file)return;try{if(file.size>2000000)throw Error('備份檔超過 2 MB');const id=importSavedWorld(await file.text());refreshSaveList(id);$('#save-status').textContent='匯入完成，請按載入世界';}catch(err){$('#save-status').textContent='未完成：'+err.message;}finally{e.target.value='';}};
$('#save-list').onchange=()=>saveAction(()=>{$('#world-name').value=savedEntry($('#save-list').value).name;});
$('#quality').onclick=()=>{
  quality=!quality; resolutionScale=1; resize(); $('#quality').textContent='畫質：'+(quality?'清晰':'省電');
};
window.addEventListener('resize',resize);
generate();
let last=performance.now(),frames=0,elapsed=0,fps=0,slowSeconds=0;
function frame(now) {
  requestAnimationFrame(frame);
  const realDt=(now-last)/1000,dt=Math.min(realDt,.1); last=now;
  frames++; elapsed+=realDt;
  if(elapsed>=1) {
    fps=Math.round(frames/elapsed); frames=0; elapsed=0;
    // 省電模式遇到慢速設備逐步降低內部解析度，CSS 畫面仍保持全螢幕。
    if(active()&&!quality&&fps<35) slowSeconds++; else slowSeconds=0;
    if(slowSeconds>=2&&resolutionScale>.5) { resolutionScale=Math.max(.5,resolutionScale-.1); resize(); slowSeconds=0; }
    $('#stats').textContent='浮島 / 採集建造\n'+fps+' FPS · '+renderer.info.render.triangles.toLocaleString()+' 三角形\n座標 '+player.x.toFixed(1)+' / '+player.y.toFixed(1)+' / '+player.z.toFixed(1);
  }
  if(active()&&ready) {
    updateLook(dt);
    if(photoState.enabled){movePhoto(dt);}else{
    updateHealthClock(dt);
    updateEffects();
    for(let t=0;t<6;t++) move(dt/6);
    updateMonsters(dt);updateMining(dt); updateDrops(dt);
    }
  } else { outline.visible=crack.visible=false; $('#target').textContent=''; }
  renderer.render(scene,camera);
}
requestAnimationFrame(frame);
