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
let lastSafe = {x:16.5, y:14, z:23.5};
const at = (x,y,z) => x + N * (z + N*y);
const inside = (x,y,z) => x>=0 && z>=0 && y>=0 && x<N && z<N && y<N;
const get = (x,y,z) => inside(x,y,z) ? world[at(x,y,z)] : 0;
const set = (x,y,z,v) => { if (inside(x,y,z)) world[at(x,y,z)] = v; };
const scene = new THREE.Scene();
scene.background = new THREE.Color('#bfe0f4');
scene.fog = new THREE.Fog('#bfe0f4', 30, 65);
const camera = new THREE.PerspectiveCamera(72, innerWidth/innerHeight, .05, 90);
camera.rotation.order = 'YXZ';
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
  mats.forEach(m=>{m.vertexColors=false;});
  const mesh = new THREE.InstancedMesh(dropGeometry,mats,32);
  mesh.count=0; mesh.frustumCulled=false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh); dropBatches[type]=mesh;
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
function generate() {
  world.fill(0); clearDrops(); inventory.fill(0); gameTime=0; nextRegenAt=Infinity;
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
  camera.position.set(player.x,player.y+(player.crouched?1.25:1.62),player.z);
  camera.rotation.set(pitch,yaw,0);
}
function move(dt) {
  // 起身時確認頭頂空間，避免在低矮通道中穿入方塊。
  player.crouched=keys.has('ControlLeft')||collides(player.x,player.y,player.z,1.8);
  const crouch=player.crouched,h=crouch?1.45:1.8;
  const forward=Number(keys.has('KeyW'))-Number(keys.has('KeyS')),side=Number(keys.has('KeyD'))-Number(keys.has('KeyA'));
  const len=Math.hypot(forward,side)||1;
  const sprint=!crouch&&keys.has('ShiftLeft')&&forward>0;
  const speed=crouch?1.7:sprint?6.5:4.3;
  const dx=(side*Math.cos(yaw)-forward*Math.sin(yaw))/len*speed*dt,dz=(-forward*Math.cos(yaw)-side*Math.sin(yaw))/len*speed*dt;
  for(const [axis,d] of [['x',dx],['z',dz]]) {
    const x=player.x+(axis==='x'?d:0),z=player.z+(axis==='z'?d:0);
    if(!collides(x,player.y,z,h)&&!(crouch&&player.ground&&!collides(x,player.y-.12,z,h))) player[axis]+=d;
  }
  if(keys.has('Space')&&player.ground&&!crouch) { player.vy=7; player.ground=false; player.peakY=player.y; }
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
function resetDig() { held=false; dig=0; digKey=''; crack.visible=false; }
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
function placeBlock(t) {
  if(!t||t.distance>5||selected>=8) return false;
  const type=selected+1;
  if(!inventory[type]) { notify('沒有'+names[type]+'，先挖掘並撿拾方塊。'); return false; }
  const x=t.x+t.n.x,y=t.y+t.n.y,z=t.z+t.n.z;
  if(!inside(x,y,z)||get(x,y,z)) return false;
  set(x,y,z,type);
  if(collides(player.x,player.y,player.z,player.crouched?1.45:1.8)) { set(x,y,z,0); return false; }
  inventory[type]--; rebuild(); updateInventory(); return true;
}
function updateMining(dt) {
  hit=target(); outline.visible=!!hit; crack.visible=false;
  if(!hit) { $('#target').textContent=''; dig=0; digKey=''; return; }
  const type=get(hit.x,hit.y,hit.z), duration=breakTime[type];
  outline.position.set(hit.x+.5,hit.y+.5,hit.z+.5);
  const key=[hit.x,hit.y,hit.z].join(',');
  if(key!==digKey) { dig=0; digKey=key; }
  if(held) {
    dig+=dt; crack.visible=true; crack.position.copy(outline.position);
    crack.material=cracks[Math.min(9,Math.floor(dig/duration*10))];
    $('#target').textContent=names[type]+' · 挖掘 '+Math.min(100,Math.floor(dig/duration*100))+'%';
    if(dig+1e-9>=duration) {
      set(hit.x,hit.y,hit.z,0);
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
  playing=false; lookPointer=null; resetDig(); keys.clear();
  document.body.classList.remove('playing');
  if(locked()) document.exitPointerLock?.();
  $('#overlay').classList.remove('hidden');
}
$('#play').onclick=()=>{
  if(!ready) return;
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
  if(active()) { keys.add(e.code); if(/^Digit[1-9]$/.test(e.code)) select(+e.code.slice(-1)-1); }
});
window.addEventListener('keyup',e=>keys.delete(e.code)); window.addEventListener('blur',pause);
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
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
  if(!active()) return;
  if(e.button===0) held=true;
  if(e.button===2) { e.preventDefault(); placeBlock(target()); }
});
window.addEventListener('mouseup',e=>{if(e.button===0)resetDig();});
$('#new').onclick=()=>{ generate(); $('#play').textContent='探索新島嶼 →'; };
$('#fullscreen').onclick=async()=>{
  try { if(document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
  catch { $('#fullscreen').textContent='請使用瀏覽器 F11'; }
};
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
    updateHealthClock(dt);
    for(let t=0;t<6;t++) move(dt/6);
    updateMining(dt); updateDrops(dt);
  } else { outline.visible=crack.visible=false; $('#target').textContent=''; }
  renderer.render(scene,camera);
}
requestAnimationFrame(frame);
