/* 純邏輯回歸檢查：使用真實 three.js 幾何，模擬 DOM 與繪圖器。 */
const fs=require('fs'),vm=require('vm'),assert=require('assert');
const events={},elements=new Map(),checks=[];
function element(){
  const classes=new Set(),children=new Map();
  return {textContent:'',disabled:false,innerHTML:'',attributes:{},
    classList:{toggle(n,on){if(on===undefined)on=!classes.has(n);on?classes.add(n):classes.delete(n);},add(n){classes.add(n);},remove(n){classes.delete(n);},contains(n){return classes.has(n);}},
    setAttribute(k,v){this.attributes[k]=v;},append(){},querySelector(s){if(!children.has(s))children.set(s,element());return children.get(s);},
    addEventListener(n,fn){this['on'+n]=fn;}
  };
}
const context={console,performance:{now:()=>0},innerWidth:1280,innerHeight:720,devicePixelRatio:1,requestAnimationFrame(){},
  document:{body:element(),querySelector(s){if(!elements.has(s))elements.set(s,element());return elements.get(s);},createElement:element,addEventListener(n,fn){events[n]=fn;}},
  window:{addEventListener(n,fn){events[n]=fn;}},setTimeout,clearTimeout};
context.self=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname+'/vendor/three.min.js','utf8'),context);
vm.runInContext(fs.readFileSync(__dirname+'/asset-data.js','utf8'),context);
vm.runInContext(`
THREE.WebGLRenderer=class{constructor(){this.info={render:{triangles:0}}}setPixelRatio(){}setSize(){}render(){}};
THREE.TextureLoader=class{load(url){if(!url.startsWith('data:image/png;base64,'))throw Error('texture source');return new THREE.Texture();}};
`,context);
vm.runInContext(fs.readFileSync(__dirname+'/game.js','utf8'),context);
function check(name,source){try{vm.runInContext(source,context);checks.push(name);console.log('通過 G'+String(checks.length).padStart(2,'0')+'：'+name);}catch(e){console.error('失敗：'+name);throw e;}}
vm.runInContext(`
function expect(value,message){if(!value)throw Error(message);}
function flat(){
 world.fill(0);clearDrops();inventory.fill(0);for(let z=0;z<N;z++)for(let x=0;x<N;x++)set(x,3,z,1);
 Object.assign(player,{x:16.5,y:4,z:16.5,vy:0,ground:true,crouched:false,peakY:4,health:10});
 gameTime=0;nextRegenAt=Infinity;lastSafe={x:16.5,y:4,z:16.5};yaw=0;pitch=0;lookPointer=null;keys.clear();resetDig();rebuild();updateCamera();
}
`,context);
check('40 次隨機世界、地表與下層材質、隨機安全出生點',`
for(let trial=0;trial<40;trial++){
 generate();expect(world.length===32768,'size');
 expect(!collides(player.x,player.y,player.z,1.8),'spawn collision');
 expect(get(Math.floor(player.x),player.y-1,Math.floor(player.z)),'spawn support');
 expect(player.health===10&&inventory.every(n=>n===0),'new game status');
 for(let z=0;z<N;z++)for(let x=0;x<N;x++){
  let top=-1;for(let y=0;y<N;y++){const b=get(x,y,z);expect(b<=8,'block type');if(b&&b!==4&&b!==5)top=y;}
  if(top>=0){expect(get(x,top,z)===1,'grass surface');if(get(x,top-1,z))expect([3,7].includes(get(x,top-1,z)),'subsurface');
   for(let y=top-2;y>=0;y--)expect([0,1,3,7].includes(get(x,y,z)),'deep types');}
 }
 for(let i=0;i<120;i++)move(1/120);expect(player.ground,'gravity');
}
`);
check('六面三角形方向、五格射線距離與大量幾何合併',`
for(const f of faces){const a=new THREE.Vector3(...f.v[0]),b=new THREE.Vector3(...f.v[1]),c=new THREE.Vector3(...f.v[2]);expect(b.sub(a).cross(c.sub(a)).dot(new THREE.Vector3(...f.n))>0,'winding');}
flat();pitch=-Math.PI/2;camera.rotation.set(pitch,0,0);camera.position.set(16.5,9.001,16.5);expect(target()===null,'beyond five');
camera.position.y=8.99;expect(target()&&target().distance<=5,'within five');expect(ray.far===5,'ray limit');
// 棋盤狀世界產生大量外露面，確認不使用大型展開參數。
world.fill(0);for(let y=0;y<N;y++)for(let z=0;z<N;z++)for(let x=0;x<N;x++)if((x+y+z)%2===0)set(x,y,z,3);rebuild();expect(terrain.geometry.getAttribute('position').count>500000,'large mesh');
`);
check('WASD、Ctrl 蹲下、Shift＋W 奔跑、跳躍、低頂起身防護',`
flat();keys.add('KeyW');move(.1);const walk=16.5-player.z;
flat();keys.add('KeyW');keys.add('ShiftLeft');move(.1);expect(16.5-player.z>walk,'sprint');expect(!player.crouched,'shift not crouch');
flat();keys.add('KeyW');keys.add('ControlLeft');move(.1);expect(player.crouched&&16.5-player.z<walk,'crouch');
flat();keys.add('KeyD');move(.1);expect(player.x>16.5,'D');keys.clear();keys.add('KeyA');move(.2);expect(player.x<16.5,'A');
flat();keys.add('KeyS');move(.1);expect(player.z>16.5,'S');
flat();keys.add('Space');move(1/120);expect(player.vy>0&&player.y>4&&!player.ground,'jump');
flat();set(16,5,16,3);player.y=3.5;player.crouched=true;move(0);expect(player.crouched,'headroom');
`);
check('八種挖掘時間、裂痕進度與取消、完成後掉落而非直接入庫',`
for(let type=1;type<=8;type++){
 flat();set(16,4,15,type);rebuild();camera.position.set(16.5,4.5,16.5);camera.rotation.set(0,0,0);held=true;
 updateMining(breakTime[type]-.01);expect(get(16,4,15)===type,'too early');expect(crack.visible,'crack');
 updateMining(.01);expect(get(16,4,15)===0,'not broken');expect(drops.length===1&&drops[0].type===type&&drops[0].count===1,'drop');expect(inventory[type]===0,'no auto inventory');
}
expect(breakTime[5]===1.5&&breakTime[3]===3&&breakTime.slice(1).every(n=>n>=1.5&&n<=3),'durations');
flat();set(16,4,15,3);rebuild();camera.position.set(16.5,4.5,16.5);camera.rotation.set(0,0,0);held=true;updateMining(1);resetDig();expect(!crack.visible&&dig===0,'cancel');held=true;updateMining(2.99);expect(get(16,4,15)===3,'restart');
`);
check('八方位一格撿拾、排除兩格與不同高度、物品數量守恆',`
for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
 flat();spawnDrop(3,2,16.5+dx,4.2,16.5+dz,0);updateDrops(0);expect(drops.length===0&&inventory[3]===2,'near pickup');
}
flat();spawnDrop(3,2,18.5,4.2,16.5,0);updateDrops(0);expect(drops.length===1&&inventory[3]===0,'too far');
flat();spawnDrop(3,2,16.5,6.2,16.5,0);updateDrops(0);expect(drops.length===1,'vertical range');
flat();spawnDrop(3,2,17.5,4.2,16.5,.35);updateDrops(0);expect(!inventory[3],'pickup delay');gameTime=.35;updateDrops(0);expect(inventory[3]===2,'pickup after delay');
flat();spawnDrop(4,2,16.5,7.2,16.5,0);spawnDrop(4,3,16.5,7.2,16.5,0);expect(drops[0].count===5,'stack merge');for(let i=0;i<240;i++)updateDrops(1/120);expect(inventory[4]===5,'fall and pickup');
`);
check('放置扣一、零數量拒絕、玩家碰撞與世界邊界拒絕',`
flat();select(0);const t={x:17,y:3,z:16,n:{x:0,y:1,z:0},distance:4};
expect(!placeBlock(t)&&!get(17,4,16),'zero count');inventory[1]=2;expect(placeBlock(t)&&inventory[1]===1&&get(17,4,16)===1,'place decrement');
expect(!placeBlock(t)&&inventory[1]===1,'occupied');
expect(!placeBlock({x:16,y:3,z:16,n:{x:0,y:1,z:0},distance:1})&&!get(16,4,16)&&inventory[1]===1,'body collision');
expect(!placeBlock({x:31,y:4,z:16,n:{x:1,y:0,z:0},distance:4})&&inventory[1]===1,'boundary');
expect(!placeBlock({...t,x:18,distance:5.001})&&inventory[1]===1,'range');
expect(placeBlock({...t,x:18,distance:5})&&inventory[1]===0,'five inclusive');
select(8);expect(!placeBlock({...t,x:19}),'empty hand');select(9);expect(selected===0,'hotbar wrap');
`);
check('實際墜落：3 格不扣血、4 格扣 2、5 格扣 5、6 格扣 6',`
for(const [height,remaining] of [[3,10],[4,8],[5,5],[6,4]]){
 flat();player.y=4+height;player.peakY=player.y;player.ground=false;
 for(let i=0;i<1000&&!player.ground;i++)move(1/120);
 expect(player.ground&&player.y===4&&player.health===remaining,'fall '+height+' health '+player.health);
}
expect(fallDamage(10)===10,'lethal fall');
`);
check('20 秒等待與 1.5 秒回血、再次受傷重設計時、最多十顆心',`
flat();damage(2);updateHealthClock(20);expect(player.health===8,'wait twenty');updateHealthClock(1.49);expect(player.health===8,'before first tick');updateHealthClock(.01);expect(player.health===9,'first tick');updateHealthClock(1.5);expect(player.health===10,'second tick');updateHealthClock(100);expect(player.health===10,'health cap');
flat();damage(2);updateHealthClock(21);damage(1);updateHealthClock(.5);expect(player.health===7,'reset regen');updateHealthClock(21);expect(player.health===8,'regenerate after reset');
expect($('#hearts').attributes['aria-label'].includes('8 / 10'),'hearts label');
`);
check('死亡清空背包、八方位兩格內散落、完整數量與安全隨機復活',`
flat();for(let type=1;type<=8;type++)inventory[type]=type*3;
const before={x:player.x,y:player.y,z:player.z};damage(10);
expect(player.health===10&&inventory.every(n=>n===0),'death reset');expect(drops.length===8,'death stacks');
for(const d of drops){expect(d.count===d.type*3,'death quantity');const dx=Math.abs(Math.floor(d.x)-Math.floor(before.x)),dz=Math.abs(Math.floor(d.z)-Math.floor(before.z));expect(Math.max(dx,dz)>=1&&Math.max(dx,dz)<=2,'scatter radius');expect((!dx||!dz||dx===dz),'eight directions');}
expect(!collides(player.x,player.y,player.z,1.8)&&get(Math.floor(player.x),player.y-1,Math.floor(player.z)),'safe respawn');expect(player.x!==before.x||player.z!==before.z,'new location');
flat();inventory[3]=7;player.y=-13;move(0);expect(player.health===10&&inventory[3]===0&&drops[0].count===7,'void death');
world.fill(0);respawn();expect(get(Math.floor(player.x),player.y-1,Math.floor(player.z)),'empty world fallback');
`);
check('邊界死亡散落仍在八方位、掉落物超過初始批次容量',`
flat();player.x=.5;player.z=.5;inventory[1]=20;damage(10);
expect(drops.length===1&&drops[0].x>=.5&&drops[0].z>=.5,'edge bounds');
expect(drops[0].x!==.5||drops[0].z!==.5,'not death cell');
flat();for(let z=0;z<8;z++)for(let x=0;x<8;x++)spawnDrop(3,1,x+.5,6,z+.5,1);renderDrops();
expect(dropBatches[3].count===64&&dropBatches[3].instanceMatrix.count>=64,'batch growth');
`);
check('水平可重複轉圈：鎖定、拒絕後邊緣持續旋轉、回中央停止、暫停停止',`
flat();ready=true;document.pointerLockElement=null;$('#play').onclick();
const turns=[];const original=rotateView;let accumulated=0;
rotateView=(x,y)=>{accumulated+=x;original(x,y);};
trackLook({clientX:innerWidth,clientY:300,movementX:0,movementY:0});
for(let i=0;i<600;i++)updateLook(1/60);
expect(accumulated>TAU*3,'fallback repeated full turns');expect(yaw>=-Math.PI&&yaw<Math.PI,'yaw normalized');
const direction=new THREE.Vector3();updateCamera();camera.getWorldDirection(direction);expect(Number.isFinite(direction.x),'camera finite');
trackLook({clientX:innerWidth/2,clientY:300});const stopYaw=yaw;
for(let i=0;i<120;i++)updateLook(1/60);expect(Math.abs(yaw-stopYaw)<1e-12,'center stop');
accumulated=0;trackLook({clientX:0,clientY:300});for(let i=0;i<600;i++)updateLook(1/60);expect(accumulated< -TAU*3,'left full turns');
pause();const paused=yaw;updateLook(1);trackLook({movementX:100});expect(yaw===paused&&lookPointer===null,'pause clear');
$('#play').onclick();document.pointerLockElement=$('#game');accumulated=0;
for(let i=0;i<80;i++)trackLook({movementX:100,movementY:0});expect(accumulated>TAU*2,'locked full turns');
const lockedYaw=yaw;lookPointer={x:innerWidth,y:300};updateLook(1);expect(yaw===lockedYaw,'no edge pan while locked');
trackLook({movementX:0,movementY:100000});expect(pitch===-1.55,'pitch lower bound');trackLook({movementX:0,movementY:-100000});expect(pitch===1.55,'pitch upper bound');
rotateView=original;document.pointerLockElement=null;pause();
for(const request of [()=>{throw Error('denied');},()=>({catch(fn){fn();}})]){
 $('#game').requestPointerLock=request;$('#play').onclick();yaw=0;trackLook({clientX:innerWidth,clientY:300});
 const before=yaw;for(let i=0;i<120;i++)updateLook(1/60);expect(yaw!==before,'denied lock edge pan');pause();
}
yaw=0;pitch=0;rotateView(TAU,0);updateCamera();camera.getWorldDirection(direction);expect(Math.abs(direction.x)<1e-9&&Math.abs(direction.z+1)<1e-9,'full circle same heading');
rotateView(Math.PI,0);updateCamera();camera.getWorldDirection(direction);expect(direction.z>.999,'half circle opposite');

`);
check('滑鼠鎖定不支援或拒絕時仍可進入、失焦暫停、載入失敗不誤啟用',`
flat();manager.onLoad();expect(ready&&!$('#play').disabled,'load success');
$('#play').onclick();expect(active(),'no lock API');pause();expect(!active()&&!held,'pause');
$('#game').requestPointerLock=()=>{throw Error('unsupported');};$('#play').onclick();expect(active(),'throw fallback');pause();
$('#game').requestPointerLock=()=>({catch(fn){fn();}});$('#play').onclick();expect(active(),'reject fallback');pause();
$('#game').requestPointerLock=()=>{document.pointerLockElement=$('#game');};$('#play').onclick();
`);
events.pointerlockchange();context.document.pointerLockElement=null;events.pointerlockchange();
check('解除滑鼠鎖定會暫停、錯誤材質保持停用',`
expect(!active(),'unlock pause');manager.onError();manager.onLoad();expect(!ready&&$('#play').disabled,'failed load stays disabled');
`);
// 確認內嵌素材內容與原始檔案逐一相同。
const map=context.window.BLOCK_TEXTURES;
assert.equal(Object.keys(map).length,20);
for(const [name,url] of Object.entries(map))assert.deepEqual(Buffer.from(url.split(',')[1],'base64'),fs.readFileSync(__dirname+'/sky-island-assets/sky-island-assets/textures/16px/'+name+'.png'));
console.log('通過 G14：20 個內嵌 PNG 與原始素材逐位元組相同');
// 文件覆蓋與本機入口路徑檢查；僅驗證 Mermaid 圍欄結構，不冒充 Mermaid 語法解析。
const read=name=>fs.readFileSync(__dirname+'/'+name,'utf8');
const verify=read('VERIFY.md'),plans=read('PLANS.md'),mermaid=read('MERMAID.md');
const expected=Array.from({length:50},(_,i)=>'V'+String(i+1).padStart(2,'0'));
const rows=[...verify.matchAll(/^\| (V\d{2}) \| (P\d{2}) \|/gm)];
assert.deepEqual(rows.map(m=>m[1]),expected,'VERIFY 必須有完整且不重複的 V01～V50');
const firstSteps=new Map();
for(const section of plans.split(/^## (?=P\d{2})/m).slice(1)){
 const step=section.match(/^P\d{2}/)[0];
 const ids=section.match(/驗收編號：([^\n]+)/)[1].match(/V\d{2}/g);
 for(const id of ids){assert(!firstSteps.has(id),'PLANS 重複 '+id);firstSteps.set(id,step);}
}
assert.deepEqual([...firstSteps.keys()].sort(),expected,'PLANS 必須覆蓋每個驗收項');
for(const row of rows)assert.equal(firstSteps.get(row[1]),row[2],'首次步驟不一致 '+row[1]);
assert.equal((mermaid.match(/^```mermaid$/gm)||[]).length,8,'預期八張流程圖');
assert.equal((mermaid.match(/^```$/gm)||[]).length,8,'Mermaid 圍欄未閉合');
const html=read('index.html');
for(const src of [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m=>m[1]))assert(fs.existsSync(__dirname+'/'+src),'入口引用遺失 '+src);
for(const name of ['AGENTS.md','BRIEF.md','README.md','VERIFICATION.md','vendor/THREE-LICENSE.txt','sky-island-assets/sky-island-assets/README.txt'])assert(fs.existsSync(__dirname+'/'+name),'缺少檔案 '+name);
console.log('通過：V01～V50 與 P01～P17 一對一對照、入口本機引用、八張 Mermaid 圍欄結構。尚未驗證 Mermaid 渲染。');
console.log(`完成 ${checks.length+1} 組功能檢查及文件靜態檢查。此結果不代表瀏覽器畫面、實際輸入、Mermaid 渲染或硬體 FPS 已驗證。`);

// E01 為 BRIEF 新增排程需求的補充測試；不改動既有 G01～G14 或唯讀 VERIFY。
vm.runInContext(`{
 const savedRandom=Math.random;
 try {
  playing=true;ready=true;gameTime=0;Math.random=()=>0;
  resetEffects();expect(effectState.type===null&&effectState.endsAt===0,'E01 initial empty');
  expect(effectState.nextAt===30,'E01 minimum wait');
  for(const sample of [0,.5,.999999]){
   Math.random=()=>sample;gameTime=7;resetEffects();
   expect(effectState.nextAt>=37&&effectState.nextAt<=67,'E01 wait bounds');
  }
  Math.random=()=>0;gameTime=0;resetEffects();
  gameTime=29.999;updateEffects();expect(effectState.type===null,'E01 no early start');
  gameTime=30;updateEffects();expect(effectState.type==='blindness'&&effectState.endsAt===50&&effectState.nextAt===60,'E01 first start');
  gameTime=49.999;updateEffects();expect(effectState.type==='blindness','E01 no early end');
  gameTime=50;updateEffects();expect(effectState.type===null&&effectState.endsAt===0&&effectState.nextAt===60,'E01 exact end');
  gameTime=59.999;updateEffects();expect(effectState.type===null,'E01 inactive gap');
  gameTime=60;updateEffects();expect(effectState.type==='blindness'&&effectState.endsAt===80,'E01 next cycle');
  const kinds=['blindness','speed','slowness','jumpBoost'];
  for(let i=0;i<4;i++){
   gameTime=0;Math.random=()=>0;resetEffects();Math.random=()=>i/4;gameTime=30;updateEffects();
   expect(effectState.type===kinds[i],'E01 kind '+i);
   const snapshot=JSON.stringify(effectState);Math.random=()=>.999999;updateEffects();expect(JSON.stringify(effectState)===snapshot,'E01 no redraw or extension');
  }
  Math.random=()=>0;gameTime=0;resetEffects();gameTime=30;playing=false;
  const paused=JSON.stringify(effectState);updateEffects();expect(JSON.stringify(effectState)===paused,'E01 paused scheduler');
  playing=true;ready=false;updateEffects();expect(JSON.stringify(effectState)===paused,'E01 not ready scheduler');
  ready=true;updateEffects();expect(effectState.type==='blindness','E01 resume due');
  // 經實際 frame 路徑觸發，並確認暫停 frame 不推進效果或 gameTime。
  flat();Math.random=()=>0;gameTime=0;resetEffects();playing=true;ready=true;gameTime=29.95;last=0;frame(100);
  expect(effectState.type==='blindness'&&Math.abs(effectState.endsAt-gameTime-20)<1e-9,'E01 frame integration');
  pause();const pausedTime=gameTime,pausedFrame=JSON.stringify(effectState);frame(200);
  expect(gameTime===pausedTime&&JSON.stringify(effectState)===pausedFrame,'E01 pause frame freeze');
  generate();expect(gameTime===0&&effectState.type===null&&effectState.endsAt===0&&effectState.nextAt===30,'E01 generate reset');
 } finally {Math.random=savedRandom;playing=false;}
}`,context);
console.log('通過 E01：30～60 秒排程、20 秒狀態、四種抽選、無重複/堆疊、暫停與新世界重設；實際效果作用尚未實作。');

// E02 以實際位移驗收倍率；不修改既有 G 與 E01 測試。
vm.runInContext(`{
 function distanceFor(type,inputs){
  flat();effectState.type=type;effectState.endsAt=20;effectState.nextAt=Infinity;
  for(const key of inputs)keys.add(key);
  const x=player.x,z=player.z;move(.1);return Math.hypot(player.x-x,player.z-z);
 }
 for(const inputs of [['KeyW'],['KeyW','ControlLeft'],['KeyW','ShiftLeft'],['KeyD'],['KeyW','KeyD']]){
  const normal=distanceFor(null,inputs),fast=distanceFor('speed',inputs),slow=distanceFor('slowness',inputs);
  expect(Math.abs(fast/normal-1.5)<1e-9,'E02 speed ratio '+inputs.join('+'));
  expect(Math.abs(slow/normal-.5)<1e-9,'E02 slow ratio '+inputs.join('+'));
  expect(Math.abs(distanceFor('blindness',inputs)/normal-1)<1e-9,'E02 blindness no speed change');
  expect(Math.abs(distanceFor('jumpBoost',inputs)/normal-1)<1e-9,'E02 jump kind no speed change');
 }
 flat();effectState.type='speed';effectState.endsAt=20;effectState.nextAt=60;keys.add('KeyW');
 const start=player.z;for(let i=0;i<120;i++)move(1/120);expect(Math.abs(start-player.z-6.45)<1e-9,'E02 no cumulative multiplier');
 flat();playing=true;ready=true;effectState.type='speed';effectState.endsAt=20;effectState.nextAt=60;keys.add('KeyW');
 gameTime=19.999;updateEffects();const before=player.z;move(.1);expect(Math.abs(before-player.z-.645)<1e-9,'E02 before expiry');
 gameTime=20;updateEffects();const expired=player.z;move(.1);expect(Math.abs(expired-player.z-.43)<1e-9,'E02 expiry restores base');
 const savedRandom=Math.random;
 try{
  Math.random=()=>0;generate();expect(effectState.type===null,'E02 generation clears modifier');
  flat();gameTime=0;resetEffects();Math.random=()=>.25;gameTime=29.95;playing=true;ready=true;keys.add('KeyW');last=0;
  const origin=player.z;frame(100);expect(effectState.type==='speed'&&Math.abs(origin-player.z-.645)<1e-9,'E02 scheduled frame movement');
  pause();const paused=player.z;frame(200);expect(player.z===paused,'E02 pause no motion');
 }finally{Math.random=savedRandom;playing=false;resetEffects();}
}`,context);
console.log('通過 E02：步行/蹲行/奔跑/橫移/斜移倍率、無累乘、到期與新世界還原、排程 frame 與暫停。');

// E03：以最高腳底實測增加三格，允許現有離散物理在不同子步下的誤差。
vm.runInContext(`{
 function jumpPeak(type,dt){
  flat();effectState.type=type;effectState.endsAt=20;effectState.nextAt=Infinity;
  const bottom=player.y;let highest=bottom;keys.add('Space');move(dt);keys.clear();highest=Math.max(highest,player.y);
  for(let i=0;i<3000&&!player.ground;i++){move(dt);highest=Math.max(highest,player.y);}
  expect(player.ground,'E03 jump lands');return highest-bottom;
 }
 for(const dt of [1/180,1/360,1/600]){
  const base=jumpPeak(null,dt),boost=jumpPeak('jumpBoost',dt);
  expect(Math.abs(boost-base-3)<.035,'E03 three block height dt '+dt);
  for(const type of ['speed','slowness','blindness'])expect(Math.abs(jumpPeak(type,dt)-base)<1e-9,'E03 other effect jump unchanged');
 }
 flat();effectState.type='jumpBoost';effectState.endsAt=20;effectState.nextAt=60;playing=true;ready=true;gameTime=20;updateEffects();
 keys.add('Space');move(1/360);expect(Math.abs(player.vy-(7-20/360))<1e-9,'E03 expired normal launch');
 flat();effectState.type='jumpBoost';keys.add('Space');keys.add('ControlLeft');move(1/360);expect(player.ground,'E03 crouch still prevents jump');
 flat();effectState.type='jumpBoost';keys.add('Space');player.y=5;player.ground=false;player.vy=0;move(1/360);expect(player.vy<0,'E03 no air jump');
 const savedRandom=Math.random;
 try{
  Math.random=()=>0;flat();gameTime=0;resetEffects();Math.random=()=>.75;gameTime=29.95;playing=true;ready=true;keys.add('Space');last=0;frame(100);
  expect(effectState.type==='jumpBoost'&&player.vy>10,'E03 scheduled boost in same frame');
  pause();const y=player.y;frame(200);expect(player.y===y,'E03 pause vertical motion');
 }finally{Math.random=savedRandom;playing=false;resetEffects();}
}`,context);
console.log('通過 E03：三種物理子步的最高腳底增加三格、非跳躍效果不變、到期還原、防空跳/蹲跳及 frame 整合。');

// E04：狀態整合與 shader 注入契約；不將此測試當成真實 WebGL 畫面證據。
vm.runInContext(`{
 flat();playing=true;ready=true;gameTime=0;resetEffects();
 effectState.type='blindness';effectState.endsAt=20;effectState.nextAt=60;updateEffects();
 expect(scene.background.getHex()===0&&scene.fog.color.getHex()===0,'E04 black sky and fog');
 expect(scene.fog.near===0&&scene.fog.far===3,'E04 three block gradient');
 expect(blindnessUniform.value===1,'E04 radial fog enabled');
 // 每個地形、裂痕、線框及掉落物材質都必須有相同的徑向霧 shader。
 const fogMaterials=[...materials,...cracks,outline.material,...dropBatches.slice(1).flatMap(m=>m.material)];
 const versions=fogMaterials.map(m=>m.version);
 for(const m of fogMaterials){
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.basic.vertexShader,fragmentShader:THREE.ShaderLib.basic.fragmentShader};
  m.onBeforeCompile(shader,renderer);
  expect(shader.uniforms.blindnessActive===blindnessUniform,'E04 shared uniform');
  expect(shader.vertexShader.includes('vRadialFogPosition = mvPosition.xyz'),'E04 camera space varying');
  expect(shader.fragmentShader.includes('length(vRadialFogPosition)'),'E04 per fragment radial distance');
  expect(shader.fragmentShader.includes('smoothstep( fogNear, fogFar, fogDistance )'),'E04 smooth gradient');
 }
 // smoothstep 的半徑契約：中心清楚、內部遞減、距離 3 與更遠全黑。
 function brightness(distance){const t=Math.max(0,Math.min(1,(distance-scene.fog.near)/(scene.fog.far-scene.fog.near)));return 1-t*t*(3-2*t);}
 expect(brightness(0)===1&&brightness(1)>brightness(2)&&brightness(2)>0,'E04 inner gradient');
 expect(brightness(3)===0&&brightness(4)===0&&brightness(Math.hypot(2.5,0,2.5))===0,'E04 far and oblique black');
 gameTime=19.999;updateEffects();expect(scene.fog.far===3,'E04 active until end');
 pause();const pausedFog=scene.fog.far,pausedTime=gameTime;last=0;frame(100);expect(scene.fog.far===pausedFog&&gameTime===pausedTime,'E04 paused vision frozen');
 playing=true;ready=true;gameTime=20;updateEffects();
 expect(scene.background.getHex()===0xbfe0f4&&scene.fog.color.getHex()===0xbfe0f4&&scene.fog.near===30&&scene.fog.far===65&&blindnessUniform.value===0,'E04 expiry restores all vision');
 expect(fogMaterials.every((m,i)=>m.version===versions[i]),'E04 no recompilation each effect');
 effectState.type='blindness';effectState.endsAt=40;updateEffects();generate();expect(scene.background.getHex()===0xbfe0f4&&scene.fog.far===65&&blindnessUniform.value===0,'E04 new world restores');
 const savedRandom=Math.random;
 try{
  Math.random=()=>0;flat();gameTime=0;resetEffects();gameTime=29.95;playing=true;ready=true;last=0;frame(100);
  expect(effectState.type==='blindness'&&scene.background.getHex()===0&&scene.fog.far===3,'E04 frame integration');
  expect(ray.far===5,'E04 interaction reach remains five');
 }finally{Math.random=savedRandom;playing=false;resetEffects();}
}`,context);
console.log('通過 E04：黑色背景、三格徑向漸層 shader、全部場景材質、到期/新局恢復、暫停與 frame；WebGL 畫面仍待實機。');

vm.runInContext(`{
 flat();playing=true;ready=true;select(0);inventory[1]=2;
 const t={x:17,y:3,z:16,n:{x:0,y:1,z:0},distance:3};
 const before=world.slice();updatePlacementPreview(t);
 expect(placementPreview.visible&&placementPreview.position.x===17.5&&placementPreview.position.y===4.5,'N01 preview adjacent');
 expect(world.every((n,i)=>n===before[i])&&inventory[1]===2,'N01 preview no mutation');
 expect(placementPreview.material.every(m=>m.transparent&&m.opacity>0&&m.opacity<1&&!m.depthWrite),'N01 translucent materials');
 for(const bad of [null,{...t,distance:5.01},{x:16,y:3,z:16,n:{x:0,y:1,z:0},distance:1},{x:31,y:4,z:16,n:{x:1,y:0,z:0},distance:2}]){updatePlacementPreview(bad);expect(!placementPreview.visible,'N01 invalid hidden');}
 inventory[1]=0;updatePlacementPreview(t);expect(!placementPreview.visible,'N01 empty hidden');inventory[1]=2;select(8);updatePlacementPreview(t);expect(!placementPreview.visible,'N01 hand hidden');select(0);
 for(const [kind,label] of [['blindness','致盲'],['speed','加速'],['slowness','減速'],['jumpBoost','跳躍提升']]){effectState.type=kind;effectState.endsAt=20;gameTime=19.1;updateEffectLabel();expect($('#effect-label').textContent===label+' · 1 秒','N01 effect label');}
 gameTime=20;updateEffectLabel();expect($('#effect-label').textContent==='','N01 expired label');updatePlacementPreview(t);pause();expect(!placementPreview.visible,'N01 pause preview');resetEffects();
}`,context);
console.log('通過 N01：半透明放置預覽、不改資料、拒絕條件、四種效果名稱倒數及暫停。');

vm.runInContext(`{
 flat();resetEffects();player.health=7;inventory[3]=4;yaw=.7;pitch=.2;spawnDrop(4,2,14.5,5,14.5,0);
 const snapshot=captureWorld();expect(snapshot.blocks.length===32768&&snapshot.bag[3]===4,'N02 capture');
 set(0,0,0,8);expect(snapshot.blocks[0]===0,'N02 deep copy');restoreWorld(snapshot);expect(world[0]===0&&inventory[3]===4&&player.health===7&&drops[0].count===2&&yaw===.7,'N02 restore');
 for(const mutate of [s=>s.version=9,s=>s.blocks.pop(),s=>s.blocks[0]=9,s=>s.bag[1]=-1,s=>s.player.x=NaN,s=>s.effect.type='evil',s=>s.drops[0].count=-1]){
  const broken=JSON.parse(JSON.stringify(snapshot));mutate(broken);const before=JSON.stringify(captureWorld());let failed=false;try{restoreWorld(broken);}catch{failed=true;}expect(failed&&JSON.stringify(captureWorld())===before,'N02 reject atomic');
 }
 const memory={value:null,getItem(){return this.value;},setItem(k,v){this.value=v;}};
 const id=saveWorld('世界 A',memory);expect(listSavedWorlds(memory)[0].name==='世界 A','N02 save name');
 renameSavedWorld(id,'<b>世界 B</b>',memory);expect(listSavedWorlds(memory)[0].name==='<b>世界 B</b>','N02 rename text');
 let failed=false;try{renameSavedWorld(id,'  ',memory);}catch{failed=true;}expect(failed,'N02 empty name reject');
 const backup=exportSavedWorld(id,memory),second=importSavedWorld(backup,memory);expect(second!==id&&listSavedWorlds(memory).length===2,'N02 backup new id');
 inventory[3]=0;loadSavedWorld(id,memory);expect(inventory[3]===4,'N02 load persisted');
 failed=false;try{saveWorld('X',{getItem(){return null;},setItem(){throw Error('quota');}});}catch{failed=true;}expect(failed,'N02 quota error');
 failed=false;try{importSavedWorld('x'.repeat(2000001),memory);}catch{failed=true;}expect(failed&&listSavedWorlds(memory).length===2,'N02 oversized reject');
}`,context);
console.log('通過 N02：快照深拷貝、完整還原、壞檔原子拒絕、命名改名、備份往返、容量與大小錯誤。');

vm.runInContext(`{
 const pitches=new Set();for(let type=1;type<=8;type++){const p=soundProfile(type,'dig');expect(p.frequency>0&&p.duration>0&&p.duration<.3,'N03 valid profile');pitches.add(p.frequency);}expect(pitches.size===8,'N03 distinct materials');
 expect(soundProfile(3,'dig').frequency!==soundProfile(3,'place').frequency&&soundProfile(3,'step').duration<soundProfile(3,'dig').duration,'N03 different actions');
 const old=playBlockSound,calls=[];playBlockSound=(type,action)=>calls.push({type,action});
 flat();keys.add('KeyW');for(let i=0;i<120;i++)move(1/120);expect(calls.some(c=>c.type===1&&c.action==='step'),'N03 ground steps');
 calls.length=0;keys.clear();for(let i=0;i<120;i++)move(1/120);expect(!calls.length,'N03 stationary silent');
 calls.length=0;inventory[1]=0;select(0);placeBlock({x:17,y:3,z:16,n:{x:0,y:1,z:0},distance:2});expect(!calls.length,'N03 failed place silent');
 inventory[1]=1;placeBlock({x:17,y:3,z:16,n:{x:0,y:1,z:0},distance:2});expect(calls.some(c=>c.action==='place'&&c.type===1),'N03 success sound');
 calls.length=0;flat();set(16,4,15,3);rebuild();camera.position.set(16.5,4.5,16.5);camera.rotation.set(0,0,0);held=true;updateMining(.01);expect(calls.some(c=>c.action==='dig'&&c.type===3),'N03 dig sound');
 playBlockSound=old;expect(playBlockSound(1,'dig')===false,'N03 no audio API graceful');resetDig();
}`,context);
console.log('通過 N03：八種材質音色、三種事件、地面步距、靜止與拒絕放置無聲、無音效 API 相容。');
