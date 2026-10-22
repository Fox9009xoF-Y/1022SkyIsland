# MERMAID.md：浮島工坊程式、功能與流程

圖中名稱對應目前 game.js。實作順序見 PLANS.md，驗收標準見 VERIFY.md，實際結果見 VERIFICATION.md。這些圖描述現有設計，不表示功能已經實機通過。沒有後端、多人、帳號或存檔服務。

## 1. 檔案與模組架構

```mermaid
flowchart TB
  rules["AGENTS.md：工作規則"] --> brief["BRIEF.md：需求與使用者明確決定"]
  brief --> plan["PLANS.md：P01 至 P11 的建構順序"]
  plan --> verify["VERIFY.md：V01 至 V37 驗收標準"]
  verify --> report["VERIFICATION.md：本輪結果與證據"]
  html["index.html：DOM、畫布、HUD、選單"] --> css["style.css：全螢幕、中央準心、愛心及快捷欄"]
  html --> three["vendor/three.min.js：本機 three.js"]
  three --> data["asset-data.js：20 張原始 PNG 的 data URL"]
  data --> game["game.js：場景及遊戲狀態"]
  source["sky-island-assets/sky-island-assets：原素材與授權"] --> data
  source --> icons["icons：八個快捷欄圖示"]
  icons --> html
  game --> world["world / generate / rebuild：固定方塊世界"]
  game --> control["keys / trackLook / updateLook / pause：輸入與狀態"]
  game --> physics["player / collides / move / updateCamera：物理"]
  game --> interact["target / updateMining / placeBlock：方塊互動"]
  game --> items["inventory / drops / updateDrops / renderDrops：物品"]
  game --> life["damage / updateHealthClock / die / respawn：生命"]
  game --> loop["frame：唯一 requestAnimationFrame 迴圈"]
  tests["check.cjs：隔離 VM、真實幾何、模擬 DOM 與 renderer"] --> game
  tests --> verify
  tests --> source
  readme["README.md：玩家操作與限制"] -. "必須與程式一致" .-> game
```

載入依賴是先 DOM，再 three.js、asset-data.js、game.js；素材包保留原始位置，不能因重構改壞既有相對路徑。

## 2. 啟動與載入狀態

```mermaid
flowchart TD
  boot["開啟 index.html，開始按鈕停用"] --> scripts["依序載入本機三個 scripts"]
  scripts --> hasThree{"THREE 存在？"}
  hasThree -->|否| libraryError["顯示函式庫載入失敗，停止初始化"]
  hasThree -->|是| renderer["建立 scene、camera、WebGLRenderer"]
  renderer --> gl{"WebGL 建立成功？"}
  gl -->|否| glError["顯示無法啟用 WebGL，停止初始化"]
  gl -->|是| callbacks["先註冊 LoadingManager 成功與錯誤回呼"]
  callbacks --> textures["由 BLOCK_TEXTURES 載入原材質與十階裂痕"]
  textures --> state["建立世界、掉落批次、HUD 與輸入事件"]
  state --> init["generate：隨機地形、重置狀態、安全出生"]
  init --> raf["啟動唯一 frame 迴圈，先顯示選單"]
  textures --> result{"材質全部成功？"}
  result -->|否| failed["loadFailed=true、ready=false，顯示錯誤並停用按鈕"]
  result -->|是| failedBefore{"之前曾載入失敗？"}
  failedBefore -->|是| failed
  failedBefore -->|否| ready["ready=true，啟用開始探索"]
  ready --> start["使用者點擊開始"]
  start --> play["playing=true、清除舊輸入、隱藏選單"]
  play --> request["在點擊手勢中嘗試 requestPointerLock"]
  request --> lock{"成功鎖定？"}
  lock -->|是| relative["使用相對位移，不受游標邊界影響"]
  lock -->|否或缺 API 或拒絕| compatible["保持遊戲執行，使用邊緣持續轉向"]
```

材質載入回呼非同步發生；上圖中建立世界不等同載入成功。只有 ready 才能開始。測試：V03、V04、V13、V14、V17；G12、G13、G14。

## 3. 360 度視角與暫停

```mermaid
flowchart TD
  event["mousemove → trackLook"] --> running{"playing？"}
  running -->|否| ignore["忽略旋轉"]
  running -->|是| locked{"pointerLockElement 是 game？"}
  locked -->|是| relative["使用 movementX / movementY"]
  locked -->|否| client["使用 clientX/Y 與上一位置的差值；首次可用 movement"]
  client --> store["保存 lookPointer"]
  relative --> rotate["rotateView：水平循環正規化，pitch 夾於正負 1.55"]
  store --> rotate
  tick["每個有效 frame → updateLook dt"] --> fallback{"playing 且未鎖定且有 lookPointer？"}
  fallback -->|否| noEdge["不做邊緣轉向"]
  fallback -->|是| edge{"位置在左右邊緣？"}
  edge -->|中央區| noEdge
  edge -->|左或右| pan["依邊緣深度與 dt 持續累加轉角，不需要新 mousemove"]
  pan --> rotate
  rotate --> camera["move → updateCamera，中央準心固定不動"]
  stop["ESC / 失焦 / 頁面隱藏 / 解除曾成功的鎖定"] --> pause["pause：playing=false、lookPointer=null、清除 keys 與挖掘"]
  pause --> menu["解除滑鼠鎖定並顯示選單"]
  late["鎖定事件延遲到暫停後才成功"] --> release["立刻解除鎖定，不偷偷恢復遊戲"]
  menu --> again["使用者再次點擊，重新開始輸入與鎖定流程"]
```

yaw 正規化只是避免無限累積數值，不限制可以旋轉的圈數。相容模式移到邊緣會持續轉，移回中央停止邊緣轉向；pitch 只限制上下以避免翻轉。測試：V09、V13～V17；G03、G06、G11～G13。

## 4. 每幀更新、物理與繪製

```mermaid
flowchart TD
  tick["requestAnimationFrame → frame now"] --> schedule["安排下一幀，計算 realDt 與上限 0.1 秒的 dt"]
  schedule --> fps["每秒更新 FPS 與座標；省電低 FPS 時逐步降低內部解析度"]
  fps --> active{"playing 且 ready？"}
  active -->|否| hide["隱藏瞄準方塊及裂痕，不推進遊戲時間"]
  active -->|是| look["updateLook dt：相容邊緣轉向"]
  look --> clock["updateHealthClock dt：gameTime、回血、提示與傷害遮罩"]
  clock --> effects["E01 排程：updateEffects，尚未套用四種實際作用"]
  effects --> enabled{"playing 且 ready？"}
  enabled -->|否| effectKeep["不改效果狀態"]
  enabled -->|是| expired{"當前效果到達 endsAt？"}
  expired -->|是| effectClear["清除種類與 endsAt"]
  expired -->|否| effectDue{"gameTime 到達 nextAt？"}
  effectClear --> effectDue
  effectDue -->|否| effectKeep
  effectDue -->|是| effectStart["隨機一種，持續 20 秒；從現在重排 30 至 60 秒"]
  effectStart --> six["六次 move dt/6 子步"]
  effectKeep --> six
  six --> input["讀 keys，決定蹲姿、步行或奔跑速度"]
  input --> horizontal["依 yaw 移動，檢查碰撞與蹲姿邊緣保護"]
  horizontal --> vertical["地面起跳、重力、小段垂直位移與碰撞"]
  vertical --> land{"落地或墜入虛空？"}
  land -->|落地| damage["更新 lastSafe、按 peakY 落差計算 damage"]
  land -->|虛空| death["die true：最後落腳處散落及復活"]
  land -->|都不是| cam["更新 peakY 與相機"]
  damage --> cam
  death --> cam
  cam --> done{"六個子步完成？"}
  done -->|否| input
  done -->|是| mine["updateMining dt：中央射線、裂痕、破壞與掉落"]
  mine --> drops["updateDrops dt：重力、拾取、更新物品欄及批次繪製"]
  drops --> render["renderer.render scene camera"]
  hide --> render
  render --> tick
```

resize 同步相機比例、內部解析度與畫布顯示尺寸。FPS 以 realDt 統計，遊戲物理使用受限 dt；模擬不能代表目標硬體的 FPS。測試：V08～V12、V17、V25～V27、V31、V32。

## 5. 挖掘、放置與數量守恆

```mermaid
flowchart TD
  aim["target：更新相機與地形矩陣，中央射線最遠 5 格"] --> hit{"命中 terrain？"}
  hit -->|否| clear["清除目標與挖掘進度"]
  hit -->|是| target["取得格座標、表面法向、距離與方塊種類"]
  target --> left{"左鍵持續按住？"}
  left -->|否| reset["挖掘進度為零，顯示方塊名稱與時間"]
  left -->|是| same{"與上一個目標同格？"}
  same -->|否| restart["清零後重新累計"]
  same -->|是| time["累加 dig，依 breakTime 換十階裂痕"]
  restart --> time
  time --> complete{"達到該種類的挖掘秒數？"}
  complete -->|否| wait["保持方塊，等待下一幀"]
  complete -->|是| remove["world 該格設為空氣"]
  remove --> drop["spawnDrop：原格同種類數量 1"]
  drop --> rebuild["rebuild：外露地形更新，清除裂痕"]
  right["右鍵 → placeBlock target"] --> valid{"有命中、距離不超過 5、不是空手？"}
  valid -->|否| deny["拒絕，數量不變"]
  valid -->|是| count{"對應 inventory 大於零？"}
  count -->|否| hint["提示先挖掘拾取，數量不變"]
  count -->|是| space{"相鄰格在邊界內且為空？"}
  space -->|否| deny
  space -->|是| write["暫時寫入方塊"]
  write --> body{"會碰撞玩家身體？"}
  body -->|是| rollback["還原空氣，不扣物品"]
  body -->|否| consume["扣一、rebuild、updateInventory"]
```

射線只選地形，避免選中裂痕或掉落物。取消挖掘、換目標與暫停都不保留舊進度。測試：V18～V24；G02、G04、G06。

## 6. 掉落物與拾取

```mermaid
flowchart TD
  spawn["spawnDrop type count x y z"] --> stack{"同格已有同類物品？"}
  stack -->|是| merge["累加 count 並更新可拾取時間"]
  stack -->|否| add["加入 drops：種類、數量、位置、速度及 pickupAt"]
  merge --> update["每幀 updateDrops"]
  add --> update
  update --> fall["重力與小段移動，落到支撐地面；世界底部停止下落"]
  fall --> delay{"達到 pickupAt？"}
  delay -->|否| keep["保留掉落物"]
  delay -->|是| near{"水平格差各不超過一且高度差不超過 1.25？"}
  near -->|否| keep
  near -->|是| collect["inventory 加完整 count，從 drops 移除"]
  collect --> hud["updateInventory：數字、名稱與選取框"]
  keep --> batch["renderDrops：按種類更新 InstancedMesh"]
  hud --> batch
  batch --> capacity{"實例數超過容量？"}
  capacity -->|是| grow["擴充批次容量並釋放舊批次"]
  capacity -->|否| matrix["更新各掉落物矩陣與 count"]
  grow --> matrix
```

空氣不掉落；物品堆疊不是只保留一個物品。死亡的 inventory 也經過相同 spawnDrop 流程。測試：V21～V24、V28；G04、G05、G06、G10。

## 7. 生命、回血、死亡與新世界

```mermaid
flowchart TD
  land["落地：取空中最高腳底與地面落差的整格數"] --> height{"落差？"}
  height -->|少於四格| safe["不扣血"]
  height -->|四格| two["扣二顆心"]
  height -->|五格以上| many["扣等同格數的心，最多十顆"]
  two --> damage["damage：扣血、傷害提示、下一次回血設於 21.5 秒後"]
  many --> damage
  damage --> alive{"剩餘血量大於零？"}
  alive -->|是| hud["更新十顆愛心與提示"]
  alive -->|否| die["die：保存死亡位置與背包數量"]
  clock["有效遊戲時間推進"] --> due{"未滿血且到達 nextRegenAt？"}
  due -->|是| regen["回一顆心，下一次再加 1.5 秒"]
  due -->|否| wait["保持狀態"]
  regen --> cap["滿血時取消回血計時"]
  void["墜入虛空"] --> anchor["以 lastSafe 為掉落中心"]
  anchor --> die
  die --> scatter["非零物品按八方向一或二格抽合法位置，以完整堆疊掉落"]
  scatter --> empty["清空 inventory，滿血、取消回血計時"]
  empty --> spots["respawn：列出有支撐且身體無碰撞的候選點"]
  spots --> exists{"有候選點？"}
  exists -->|否| grass["補一格草地作安全落腳處"]
  exists -->|是| random["隨機選擇，盡可能避開原位置"]
  grass --> random
  random --> reset["清除舊速度、輸入及挖掘，更新相機與 HUD"]
  new["選單重新生成 → generate"] --> fresh["清空世界、背包、掉落物、計時與受傷畫面"]
  fresh --> terrain["建立隨機地層與樹，rebuild"]
  terrain --> spots
```

新傷會重設回血等待；gameTime 在暫停時不前進。死亡後可重新拾回散落物；關閉或重新整理頁面不保存狀態。測試：V25～V30、V33；G01、G07～G10。

## 8. 建構順序與強制完整回歸

```mermaid
flowchart TD
  rules["讀 AGENTS、BRIEF、最新使用者決定"] --> p1["P01：檔案與需求，V01 至 V02"]
  p1 --> p2["P02：入口與素材，V03 至 V04"]
  p2 --> p3["P03：世界與幾何，V05 至 V08"]
  p3 --> p4["P04：移動與物理，V09 至 V12"]
  p4 --> p5["P05：360 度視角與控制，V13 至 V17"]
  p5 --> p6["P06：挖掘與射線，V18 至 V21"]
  p6 --> p7["P07：掉落、拾取與放置，V22 至 V24"]
  p7 --> p8["P08：生命與傷害，V25 至 V27"]
  p8 --> p9["P09：死亡與新世界，V28 至 V30"]
  p9 --> p10["P10：整合與硬體，V31 至 V34"]
  p10 --> p11["P11：完整回歸與文件，V35 至 V37"]
  each["每步修改完成"] --> syntax["兩項語法檢查及 G01 至 G14"]
  syntax --> old["從 P01 起，重新驗證前面所有已完成步驟，再驗當前步驟"]
  old --> result{"當前與前段驗收結果？"}
  result -->|失敗| fix["記錄問題並修正，先前結果全部失效"]
  fix --> each
  result -->|工具或設備不能測| blocked["記錄部分通過或未驗證，保留待辦，不能宣稱全過"]
  result -->|全部通過| next["繼續下一個 P 步驟"]
  p11 --> all["最後一次修改後完整執行 V01 至 V37"]
  all --> final{"每一項都有本輪通過證據？"}
  final -->|是| done["交付程式、文件與逐條驗證結果"]
  final -->|否且可修| fix
  final -->|否且受限| blocked
```

P01～P11 是依賴順序；旁邊的「每步修改完成」子流程適用於每一個 P 步驟。後段修正不得只測局部，必須使先前結果失效並從 P01 重驗所有已完成內容。手動或目標硬體證據不能由邏輯測試代替。


### 隨機效果 E01 變更紀錄

本輪先完成排程狀態：effectState 包含 type、endsAt、nextAt，generate 呼叫 resetEffects；frame 在 updateHealthClock 後、move 前呼叫 updateEffects。上方第 4 圖納入到期與觸發分支。進入新世界重抽首次 30～60 秒，依遊戲時間計算且暫停不前進；不變更實際移動、跳躍及霧效果。

未完成：E02 加速/減速倍率、E03 跳躍多三格、E04 三格內漸層與三格外全黑。這些都必須各自先紅燈提交、實作、全套前段重驗，再綠燈提交，完成一步就停止。架構文件同步不代表獲得修改 VERIFY.md 的授權。
