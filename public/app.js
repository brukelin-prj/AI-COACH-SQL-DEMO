import {
  PoseLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8";

// ================= 全局系統偵錯日誌攔截器 =================
function logToScreen(message, isError = false) {
  const consoleDiv = document.getElementById("debug-console");
  const listDiv = document.getElementById("debug-log-list");
  if (consoleDiv && listDiv) {
    consoleDiv.style.display = "block";
    const item = document.createElement("div");
    item.style.marginBottom = "6px";
    item.style.color = isError ? "#ff5555" : "#55ff55";
    item.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    listDiv.appendChild(item);
    consoleDiv.scrollTop = consoleDiv.scrollHeight;
  }
}

// 攔截 console.error & console.warn
const originalConsoleError = console.error;
console.error = function (...args) {
  logToScreen("[Error] " + args.join(" "), true);
  originalConsoleError.apply(console, args);
};

const originalConsoleWarn = console.warn;
console.warn = function (...args) {
  logToScreen("[Warn] " + args.join(" "), true);
  originalConsoleWarn.apply(console, args);
};

const originalConsoleLog = console.log;
console.log = function (...args) {
  const msg = args.join(" ");
  if (msg.includes("DATABASE") || msg.includes("AI") || msg.includes("Camera") || msg.includes("偵測") || msg.includes("成功") || msg.includes("失敗")) {
    logToScreen("[Info] " + msg, false);
  }
  originalConsoleLog.apply(console, args);
};

// ================= 常數與關鍵點索引 =================
const LS_ID = 11, RS_ID = 12; // 左右肩
const LH_ID = 23, RH_ID = 24; // 左右臀
const LK_ID = 25, RK_ID = 26; // 左右膝
const LA_ID = 27, RA_ID = 28; // 左右踝
const LE_ID = 13, RE_ID = 14; // 左右肘
const LW_ID = 15, RW_ID = 16; // 左右腕

// 動作閥值
const REP_THRESHOLD_RATIO = 0.70;
const REP_RECOVERY_RATIO = 0.95;
const COM_TOLERANCE_PX = 30; // 30 像素
const SQUAT_TARGET_ANGLE = 90;
const SQUAT_ANGLE_TOLERANCE = 15; // 寬放為 90 +/- 15 度

// ================= DOM 元素宣告 =================
const webcamElement = document.getElementById("webcam");
const canvasElement = document.getElementById("output-canvas");
const ctx = canvasElement.getContext("2d");
const loadingOverlay = document.getElementById("loading-overlay");
const modelStatusText = document.getElementById("model-status-text");
const modelSpinner = document.getElementById("model-spinner");
const fpsCounter = document.getElementById("fps-counter");

// 按鈕與控制項
const btnToggleCamera = document.getElementById("btn-toggle-camera");
const chkMirror = document.getElementById("chk-mirror");
const chkTts = document.getElementById("chk-tts");
const btnTwist = document.getElementById("btn-twist");
const btnSquat = document.getElementById("btn-squat");
const btnSidebend = document.getElementById("btn-sidebend");

// 數據看板
const repDisplay = document.getElementById("rep-display");
const repStatus = document.getElementById("rep-status");
const scoreDisplay = document.getElementById("score-display");
const scoreBar = document.getElementById("score-bar");
const feedbackList = document.getElementById("feedback-list");
const posePerfectBadge = document.getElementById("pose-perfect-badge");

// 指標值元件
const metricTwistAngle = document.getElementById("metric-twist-angle");
const metricShoulderHipRatio = document.getElementById("metric-shoulder-hip-ratio");
const metricSquatSide = document.getElementById("metric-squat-side");
const metricKneeAngle = document.getElementById("metric-knee-angle");
const metricArmAngle = document.getElementById("metric-arm-angle");
const metricComOffset = document.getElementById("metric-com-offset");

// 體側彎指標元件
const metricSidebendAngle = document.getElementById("metric-sidebend-angle");
const metricSidebendDirection = document.getElementById("metric-sidebend-direction");
const metricSidebendHipShift = document.getElementById("metric-sidebend-hip-shift");
const metricSidebendArmStatus = document.getElementById("metric-sidebend-arm-status");

// 指導方針元件
const guideTwist = document.getElementById("guide-twist");
const guideSquat = document.getElementById("guide-squat");
const guideSidebend = document.getElementById("guide-sidebend");

// --- 資料庫 / 儀表板新 DOM 元素 ---
const userSelect = document.getElementById("user-select");
const btnShowAddUser = document.getElementById("btn-show-add-user");
const newUserForm = document.getElementById("new-user-form");
const txtNewUsername = document.getElementById("txt-new-username");
const btnCreateUser = document.getElementById("btn-create-user");
const btnCancelUser = document.getElementById("btn-cancel-user");
const btnSaveSession = document.getElementById("btn-save-session");
const lblActiveUser = document.getElementById("lbl-active-user");

const dbTotalWorkouts = document.getElementById("db-total-workouts");
const dbTotalReps = document.getElementById("db-total-reps");
const dbAvgScore = document.getElementById("db-avg-score");
const historyTableBody = document.getElementById("history-table-body");

const saveSuccessModal = document.getElementById("save-success-modal");
const btnCloseModal = document.getElementById("btn-close-modal");
const modalSummaryMode = document.getElementById("modal-summary-mode");
const modalSummaryReps = document.getElementById("modal-summary-reps");
const modalSummaryScore = document.getElementById("modal-summary-score");

// 個人化叮嚀元件
const personalizedCoachTip = document.getElementById("personalized-coach-tip");
const coachTipText = document.getElementById("coach-tip-text");

// ================= 應用程式狀態 =================
let activeMode = "twist"; // "twist", "squat", "sidebend"
let isCameraActive = false;
let poseLandmarker = null;
let webcamStream = null;
let animationFrameId = null;

// 緩衝區與運動統計
let repsCount = 0;
let lastRepTime = 0;
let repState = "neutral";
let stableFrames = 0; // 用於體側彎的穩定影格數檢測
const angleBuffer = [];
const ratioBuffer = [];
const BUFFER_MAX_LEN = 5;

// FPS 計算
let lastFpsTime = performance.now();
let frameCount = 0;
let currentFps = 0;

// TTS 控制
let lastSpeechTime = 0;
const SPEECH_COOLDOWN = 2000; // 每次語音間隔至少 2 秒

// 資料庫與歷史狀態
let activeUser = null;
let sessionScores = [];
let sessionStartTime = null;
let trendChartInstance = null;
let userStats = null;
const readableModeNames = {
  twist: "腰部扭轉",
  squat: "深蹲動作",
  sidebend: "體側彎動作"
};

// 緩存顯示變數，防止畫面跳動
let cachedState = {
  score: 100,
  feedback: [],
  perfect: true,
  avgAngle: 0.0,
  avgRatio: 0.0,
  landmarks: null
};

// ================= 初始化 AI 模型 =================
async function initPoseModel() {
  try {
    modelStatusText.textContent = "載入模型資源中...";
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.8/wasm"
    );
    
    poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numPoses: 1
    });

    modelStatusText.textContent = "AI 模型準備就緒";
    modelSpinner.classList.add("hidden");
    loadingOverlay.classList.add("hidden");
    
    // 預先啟用按鈕
    btnToggleCamera.classList.remove("btn-disabled");
    btnToggleCamera.disabled = false;
  } catch (error) {
    console.error("AI 模型載入失敗:", error);
    modelStatusText.textContent = "模型載入失敗";
    alert("MediaPipe 模型載入失敗，請確認網路連線是否正常。");
  }
}

// ================= 語音合成系統 (Web Speech API) =================
function speakText(text) {
  if (!chkTts.checked) return;
  const now = Date.now();
  if (now - lastSpeechTime < SPEECH_COOLDOWN) return;

  // 立即取消前一通語音以避免排隊延遲
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-TW";
  utterance.rate = 1.1; // 稍微快一點，語氣較自然俐落
  
  // 試著取得中文語音人聲
  const voices = window.speechSynthesis.getVoices();
  const zhVoice = voices.find(v => v.lang.includes("zh-TW") || v.lang.includes("zh-HK") || v.lang.includes("zh-CN"));
  if (zhVoice) {
    utterance.voice = zhVoice;
  }

  window.speechSynthesis.speak(utterance);
  lastSpeechTime = now;
}

// ================= 幾何力學計算函數 =================

// 計算 2D 平面上 A-B-C 三點的夾角 (B 為頂點)
function calculateAngle(a, b, c) {
  const ba = { x: a.x - b.x, y: a.y - b.y };
  const bc = { x: c.x - b.x, y: c.y - b.y };

  const dotProduct = ba.x * bc.x + ba.y * bc.y;
  const normBA = Math.sqrt(ba.x * ba.x + ba.y * ba.y);
  const normBC = Math.sqrt(bc.x * bc.x + bc.y * bc.y);

  if (normBA === 0 || normBC === 0) return 180.0;

  let cosAngle = dotProduct / (normBA * normBC);
  cosAngle = Math.max(-1.0, Math.min(1.0, cosAngle)); // 防止溢出精度錯誤
  
  const angleRad = Math.acos(cosAngle);
  return angleRad * (180.0 / Math.PI);
}

// 依肩寬與臀寬比例計算扭轉角度
function calculateAngleFromRatio(shoulderWidth, hipWidth) {
  if (hipWidth <= 0) return 0.0;
  let ratio = shoulderWidth / hipWidth;
  ratio = Math.max(0.0, Math.min(1.0, ratio));
  if (ratio >= 1.0) return 0.0;
  const angleRad = Math.acos(ratio);
  return angleRad * (180.0 / Math.PI);
}

// ================= 相機串流管理 =================
async function toggleCamera() {
  if (isCameraActive) {
    stopCamera();
  } else {
    await startCamera();
  }
}

async function startCamera() {
  if (!poseLandmarker) return;
  
  try {
    loadingOverlay.classList.remove("hidden");
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user"
      },
      audio: false
    });
    
    webcamElement.srcObject = webcamStream;
    webcamElement.play().catch(err => {
      console.warn("webcamElement.play() failed or was interrupted:", err);
    });
    webcamElement.addEventListener("loadedmetadata", () => {
      // 依據相機解析度同步設定 Canvas 尺寸
      canvasElement.width = webcamElement.videoWidth;
      canvasElement.height = webcamElement.videoHeight;
      
      loadingOverlay.classList.add("hidden");
      isCameraActive = true;
      btnToggleCamera.textContent = "關閉相機";
      btnToggleCamera.classList.replace("primary-btn", "btn-disabled");
      
      // 重設計數器與 Session 數據
      repsCount = 0;
      repDisplay.textContent = repsCount;
      stableFrames = 0;
      sessionScores = [];
      sessionStartTime = Date.now();
      updateSaveButtonState();
      
      // 開始繪製與運算迴圈
      lastFpsTime = performance.now();
      frameCount = 0;
      animationFrameId = requestAnimationFrame(detectionLoop);
      
      speakText("相機已開啟，請退後至全身入鏡");
    });
  } catch (error) {
    console.error("相機開啟失敗:", error);
    loadingOverlay.classList.add("hidden");
    alert("無法存取相機，請檢查瀏覽器權限設定。");
  }
}

function stopCamera() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  
  if (webcamStream) {
    webcamStream.getTracks().forEach(track => track.stop());
    webcamStream = null;
  }
  
  webcamElement.srcObject = null;
  ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  
  isCameraActive = false;
  btnToggleCamera.textContent = "開啟相機";
  btnToggleCamera.classList.replace("btn-disabled", "primary-btn");
  fpsCounter.textContent = "FPS: 0.0";
  
  feedbackList.innerHTML = `<div class="feedback-placeholder">請開啟相機並站立於畫面前以開始偵測...</div>`;
  posePerfectBadge.classList.remove("visible");
  
  speakText("相機已關閉");
  updateSaveButtonState();
}

function detectionLoop() {
  if (!isCameraActive || !poseLandmarker) return;
  
  if (webcamElement.readyState >= 2) {
    try {
      // 動態確保 Canvas 解析度與 Video 尺寸一致
      if (webcamElement.videoWidth && webcamElement.videoHeight) {
        if (canvasElement.width !== webcamElement.videoWidth || canvasElement.height !== webcamElement.videoHeight) {
          canvasElement.width = webcamElement.videoWidth;
          canvasElement.height = webcamElement.videoHeight;
        }
      }

      // 偵錯日誌：輸出相機與畫布尺寸
      if (!window.hasLoggedSizes && webcamElement.videoWidth > 0) {
        window.hasLoggedSizes = true;
        console.log(`[Camera] Video size: ${webcamElement.videoWidth}x${webcamElement.videoHeight}, Canvas size: ${canvasElement.width}x${canvasElement.height}`);
      }

      // 計算實時 FPS
      frameCount++;
      const timeNow = performance.now();
      if (timeNow - lastFpsTime >= 1000) {
        currentFps = (frameCount * 1000) / (timeNow - lastFpsTime);
        fpsCounter.textContent = `FPS: ${currentFps.toFixed(1)}`;
        frameCount = 0;
        lastFpsTime = timeNow;
      }

      const timestampMs = performance.now();
      const result = poseLandmarker.detectForVideo(webcamElement, timestampMs);
      
      // 清除前一幀繪圖
      ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
      
      // 解析度縮放因子
      const w = canvasElement.width;
      const h = canvasElement.height;

      // 暫存目前的運算狀態
      let currentPerfect = true;
      let currentFeedback = [];
      let currentScore = 100;

      if (result.poseLandmarks && result.poseLandmarks.length > 0) {
        const lm = result.poseLandmarks[0]; // 只抓取第一個人體骨架
        
        if (!window.hasLoggedDetection) {
          window.hasLoggedDetection = true;
          console.log(`[AI] Pose detected! Landmarks count: ${lm.length}`);
        }
        
        if (lm.length >= 29) {
          cachedState.landmarks = lm;

      if (activeMode === "twist") {
        // =============== 1. 扭腰動作邏輯 ===============
        const ls = lm[LS_ID];
        const rs = lm[RS_ID];
        const lh = lm[LH_ID];
        const rh = lm[RH_ID];
        const lk = lm[LK_ID];
        const rk = lm[RK_ID];
        const la = lm[LA_ID];
        const ra = lm[RA_ID];

        // 檢查關鍵關節可見度
        const requiredJoints = [LS_ID, RS_ID, LH_ID, RH_ID];
        let jointsVisible = true;
        for (const idx of requiredJoints) {
          if (lm[idx] && lm[idx].visibility !== undefined && lm[idx].visibility < 0.5) {
            jointsVisible = false;
            break;
          }
        }

        if (!jointsVisible) {
          metricTwistAngle.textContent = "-";
          metricShoulderHipRatio.textContent = "-";
          currentFeedback.push("關鍵關節（肩膀、臀部）未完全入鏡，請退後調整位置");
          currentPerfect = false;
          currentScore = 0;
        } else {
          const shoulderWidth = Math.abs(rs.x - ls.x);
          const hipWidth = Math.abs(rh.x - lh.x);

          const currentRatio = shoulderWidth / Math.max(hipWidth, 0.01);
          const currentAngle = calculateAngleFromRatio(shoulderWidth, hipWidth);

          // 緩衝器平滑化
          angleBuffer.push(currentAngle);
          ratioBuffer.push(currentRatio);
          if (angleBuffer.length > BUFFER_MAX_LEN) angleBuffer.shift();
          if (ratioBuffer.length > BUFFER_MAX_LEN) ratioBuffer.shift();

          cachedState.avgAngle = angleBuffer.reduce((a, b) => a + b, 0) / angleBuffer.length;
          cachedState.avgRatio = ratioBuffer.reduce((a, b) => a + b, 0) / ratioBuffer.length;

          // 計算對稱水平度與偏移
          const shoulderTilt = Math.abs(ls.y - rs.y);
          const hipTilt = Math.abs(lh.y - rh.y);
          const bodyShiftX = Math.abs((ls.x + rs.x) / 2 - (lh.x + rh.x) / 2);

          // 雙膝夾角
          const leftKnee = calculateAngle(lh, lk, la);
          const rightKnee = calculateAngle(rh, rk, ra);
          const avgKnee = (leftKnee + rightKnee) / 2;

          const timeSec = Date.now() / 1000;

          // --- 次數計數狀態機 ---
          if (cachedState.avgRatio < REP_THRESHOLD_RATIO && repState === "neutral") {
            repState = "twisting";
            repStatus.textContent = "Twisting";
            repStatus.style.color = "var(--accent-yellow)";
            if (timeSec - lastRepTime > 2.0) {
              speakText("開始扭轉");
            }
          } else if (repState === "twisting" && cachedState.avgRatio > REP_RECOVERY_RATIO) {
            if (timeSec - lastRepTime > 1.0) {
              repsCount++;
              repDisplay.textContent = repsCount;
              lastRepTime = timeSec;
              repState = "returning";
              repStatus.textContent = "Done";
              repStatus.style.color = "var(--accent-green)";
              
              speakText(`第 ${repsCount} 下`);
              
              if (cachedState.avgAngle >= 35 && cachedState.avgAngle <= 55) {
                speakText("完美姿勢");
              } else {
                speakText("注意扭轉角度");
              }
              updateSaveButtonState();
            }
          } else if (cachedState.avgRatio > 0.95) {
            repState = "neutral";
            repStatus.textContent = "Neutral";
            repStatus.style.color = "var(--text-secondary)";
          }

          // --- 評分核心邏輯 ---
          let scorePart = 0;

          // A. 扭腰角度評分 (40 分)
          if (cachedState.avgAngle >= 35 && cachedState.avgAngle <= 55) {
            scorePart += 40;
          } else if (cachedState.avgAngle < 35) {
            scorePart += Math.max(0, 40 - (35 - cachedState.avgAngle) * 2.5);
            currentFeedback.push("請加大腰部扭轉幅度");
            currentPerfect = false;
          } else {
            scorePart += Math.max(0, 40 - (cachedState.avgAngle - 55) * 2.5);
            currentFeedback.push("扭轉幅度過大，請稍減");
            currentPerfect = false;
          }

          // B. 骨盆水平穩定度 (20 分)
          if (hipTilt < 0.05) {
            scorePart += 20;
          } else {
            scorePart += Math.max(0, 20 - hipTilt * 250);
            currentFeedback.push("請保持骨盆水平，不要傾斜");
            currentPerfect = false;
          }

          // C. 肩膀水平度 (15 分)
          if (shoulderTilt < 0.05) {
            scorePart += 15;
          } else {
            scorePart += Math.max(0, 15 - shoulderTilt * 250);
            currentFeedback.push("肩膀傾斜，請兩側維持水平");
            currentPerfect = false;
          }

          // D. 膝蓋微彎度 (15 分)
          if (avgKnee >= 160) {
            scorePart += 15;
          } else {
            scorePart += Math.max(0, 15 - (160 - avgKnee) * 1.5);
            currentFeedback.push("膝蓋彎曲過深，請稍微直立");
            currentPerfect = false;
          }

          // E. 身體中軸穩定度 (10 分)
          if (bodyShiftX < 0.05) {
            scorePart += 10;
          } else {
            scorePart += Math.max(0, 10 - bodyShiftX * 250);
            currentFeedback.push("身體請勿左右歪斜晃動");
            currentPerfect = false;
          }

          currentScore = Math.round(scorePart);

          // 即時語音提醒
          if (!currentPerfect && timeSec - lastRepTime > 1.8) {
            if (currentFeedback.length > 0) {
              speakText(currentFeedback[0]); // 播報最主要的一項建議
            }
          }

          // 更新數據看板指標
          metricTwistAngle.textContent = `${cachedState.avgAngle.toFixed(1)}°`;
          metricShoulderHipRatio.textContent = cachedState.avgRatio.toFixed(2);
        }

      } else if (activeMode === "squat") {
        // =============== 2. 深蹲動作邏輯 ===============
        const ls_x = lm[LS_ID].x * w;
        const rs_x = lm[RS_ID].x * w;

        // A. 檢測方向 (正面誤判阻擋)
        if (Math.abs(ls_x - rs_x) < w * 0.1) {
          metricSquatSide.textContent = "正面 (請側身)";
          metricSquatSide.style.color = "var(--accent-red)";
          currentFeedback.push("檢測到正面，請轉向側面以利分析深蹲");
          currentPerfect = false;
          currentScore = 30;
        } else {
          let s_idx, h_idx, k_idx, e_idx, a_idx, w_idx;
          let sideLabel = "";

          if (ls_x < rs_x) {
            sideLabel = "左側在前 (面向右)";
            s_idx = 11; h_idx = 23; k_idx = 25; e_idx = 13; a_idx = 27; w_idx = 15;
          } else {
            sideLabel = "右側在前 (面向左)";
            s_idx = 12; h_idx = 24; k_idx = 26; e_idx = 14; a_idx = 28; w_idx = 16;
          }

          metricSquatSide.textContent = sideLabel;
          metricSquatSide.style.color = "var(--text-primary)";

          // 檢查關鍵關節可見度
          const requiredJoints = [s_idx, h_idx, k_idx, a_idx];
          let jointsVisible = true;
          for (const idx of requiredJoints) {
            if (lm[idx] && lm[idx].visibility !== undefined && lm[idx].visibility < 0.5) {
              jointsVisible = false;
              break;
            }
          }

          if (!jointsVisible) {
            metricKneeAngle.textContent = "-";
            metricArmAngle.textContent = "-";
            metricComOffset.textContent = "-";
            metricComOffset.style.color = "var(--text-secondary)";
            currentFeedback.push("關鍵關節（膝蓋、腳踝）未完全入鏡，請退後使全身入鏡");
            currentPerfect = false;
            currentScore = 0;
          } else {
            // 取出 2D 關節座標
            const shoulder = { x: lm[s_idx].x * w, y: lm[s_idx].y * h };
            const hip = { x: lm[h_idx].x * w, y: lm[h_idx].y * h };
            const knee = { x: lm[k_idx].x * w, y: lm[k_idx].y * h };
            const elbow = { x: lm[e_idx].x * w, y: lm[e_idx].y * h };
            const ankle = { x: lm[a_idx].x * w, y: lm[a_idx].y * h };
            const wrist = { x: lm[w_idx].x * w, y: lm[w_idx].y * h };

            // 計算角度
            const kneeAngle = calculateAngle(hip, knee, ankle);
            const armAngle = calculateAngle(shoulder, elbow, wrist);

            // 計算重心偏離度 (以腳踝與臀部的水平差距計算)
            let centerOffset = 0;
            let centerOk = true;

            if (sideLabel.includes("面向右")) {
              centerOffset = ankle.x - hip.x;
            } else {
              centerOffset = hip.x - ankle.x;
            }

            const timeSec = Date.now() / 1000;

            // --- 深蹲次數計數狀態機 ---
            // 下蹲達標閥值 (膝蓋夾角小於 110 度進入深蹲區)
            if (kneeAngle < 110 && repState === "neutral") {
              repState = "squatting";
              repStatus.textContent = "Squatting";
              repStatus.style.color = "var(--accent-yellow)";
              if (timeSec - lastRepTime > 2.0) {
                speakText("向下深蹲");
              }
            } else if (repState === "squatting" && kneeAngle > 150) {
              // 站立起身大於 150 度完成一次
              if (timeSec - lastRepTime > 1.0) {
                repsCount++;
                repDisplay.textContent = repsCount;
                lastRepTime = timeSec;
                repState = "returning";
                repStatus.textContent = "Done";
                repStatus.style.color = "var(--accent-green)";
                
                speakText(`第 ${repsCount} 下`);
                
                if (Math.abs(kneeAngle - SQUAT_TARGET_ANGLE) <= SQUAT_ANGLE_TOLERANCE) {
                  speakText("深蹲標準");
                } else {
                  speakText("起立，注意下蹲深度");
                }
                updateSaveButtonState();
              }
            } else if (kneeAngle > 150) {
              repState = "neutral";
              repStatus.textContent = "Neutral";
              repStatus.style.color = "var(--text-secondary)";
            }

            // --- 深蹲評分標準 (滿分 100) ---
            let squatScore = 100;

            // 1. 膝關節深蹲深度評分 (40 分)
            if (Math.abs(kneeAngle - SQUAT_TARGET_ANGLE) <= SQUAT_ANGLE_TOLERANCE) {
              // 角度落在 75 ~ 105 度間
            } else if (kneeAngle < 75) {
              squatScore -= Math.min(25, (75 - kneeAngle) * 1.5);
              currentFeedback.push("下蹲過深，膝蓋壓力較大");
              currentPerfect = false;
            } else {
              squatScore -= Math.min(30, (kneeAngle - 105) * 1.5);
              currentFeedback.push("下蹲深度不足，請蹲低一點");
              currentPerfect = false;
            }

            // 2. 手臂平舉平平行度評分 (30 分)
            if (Math.abs(armAngle - 90) <= 20) {
              // 70 ~ 110 度間
            } else if (armAngle < 70) {
              squatScore -= 15;
              currentFeedback.push("雙手請向上平舉平行地面");
              currentPerfect = false;
            } else {
              squatScore -= 15;
              currentFeedback.push("手臂抬起過高");
              currentPerfect = false;
            }

            // 3. 重心偏移評分 (30 分)
            if (centerOffset < -COM_TOLERANCE_PX) {
              centerOk = false;
              squatScore -= 20;
              currentFeedback.push("重心太靠前，請移向後腳跟");
              currentPerfect = false;
            } else if (centerOffset > w * 0.22) {
              centerOk = false;
              squatScore -= 20;
              currentFeedback.push("重心太靠後，請稍微往前移");
              currentPerfect = false;
            }

            currentScore = Math.max(0, squatScore);

            // 即時語音提醒
            if (!currentPerfect && timeSec - lastRepTime > 1.8) {
              if (currentFeedback.length > 0) {
                speakText(currentFeedback[0]);
              }
            }

            // 更新數據看板指標
            metricKneeAngle.textContent = `${Math.round(kneeAngle)}°`;
            metricArmAngle.textContent = `${Math.round(armAngle)}°`;
            metricComOffset.textContent = `${Math.round(centerOffset)}px`;
            metricComOffset.style.color = centerOk ? "var(--text-primary)" : "var(--accent-red)";
          }
        }
      } else if (activeMode === "sidebend") {
        // =============== 3. 體側彎動作邏輯 ===============
        const ls = lm[LS_ID];
        const rs = lm[RS_ID];
        const lh = lm[LH_ID];
        const rh = lm[RH_ID];
        const lk = lm[LK_ID];
        const rk = lm[RK_ID];
        const la = lm[LA_ID];
        const ra = lm[RA_ID];
        const lw = lm[LW_ID];
        const rw = lm[RW_ID];

        // 檢查關鍵關節可見度
        const requiredJoints = [LS_ID, RS_ID, LH_ID, RH_ID, LA_ID, RA_ID];
        let jointsVisible = true;
        for (const idx of requiredJoints) {
          if (lm[idx] && lm[idx].visibility !== undefined && lm[idx].visibility < 0.5) {
            jointsVisible = false;
            break;
          }
        }

        if (!jointsVisible) {
          metricSidebendAngle.textContent = "-";
          metricSidebendDirection.textContent = "-";
          metricSidebendHipShift.textContent = "-";
          metricSidebendArmStatus.textContent = "-";
          currentFeedback.push("關鍵關節（肩膀、臀部、腳踝）未完全入鏡，請退後使全身入鏡");
          currentPerfect = false;
          currentScore = 0;
        } else {
          // 計算肩膀中心、髖部中心、雙踝中心
          const shoulderCenter = {
            x: (ls.x + rs.x) / 2,
            y: (ls.y + rs.y) / 2,
            z: (ls.z + rs.z) / 2
          };
          const hipCenter = {
            x: (lh.x + rh.x) / 2,
            y: (lh.y + rh.y) / 2
          };
          const feetCenter = {
            x: (la.x + ra.x) / 2,
            y: (la.y + ra.y) / 2
          };

          // 側彎傾斜角度
          const dx = shoulderCenter.x - hipCenter.x;
          const dy = shoulderCenter.y - hipCenter.y; // 由於肩膀在上方，dy 為負數
          const bendAngle = Math.atan2(Math.abs(dx), Math.abs(dy)) * (180.0 / Math.PI);

          // 側彎方向判定
          let bendDirection = "直立";
          if (bendAngle >= 10) {
            bendDirection = dx > 0 ? "向右側彎" : "向左側彎";
          }

          // 髖部左右偏移 (Hip Shift)
          const hipShift = Math.abs(hipCenter.x - feetCenter.x);

          // 身體前傾/扭轉檢測 (使用左右肩深度座標差值)
          const shoulderZDiff = Math.abs(ls.z - rs.z);

          // 手部上舉判定
          let armStatus = "未上舉";
          let isArmRaised = false;

          if (bendDirection === "向右側彎") {
            // 向右側彎時，左臂應上舉高於左肩
            if (lw.y < ls.y) {
              armStatus = "左手已上舉";
              isArmRaised = true;
            } else {
              armStatus = "左手未抬高";
            }
          } else if (bendDirection === "向左側彎") {
            // 向左側彎時，右臂應上舉高於右肩
            if (rw.y < rs.y) {
              armStatus = "右手已上舉";
              isArmRaised = true;
            } else {
              armStatus = "右手未抬高";
            }
          }

          const timeSec = Date.now() / 1000;

          // --- 評分機制 (滿分 100) ---
          let sidebendScore = 100;

          // A. 側彎角度檢測 (40 分)
          if (bendAngle >= 27 && bendAngle <= 43) {
            // 合格
          } else if (bendAngle < 27) {
            if (bendAngle >= 10) {
              sidebendScore -= Math.min(30, (27 - bendAngle) * 2.5);
              currentFeedback.push("請再側彎一點");
            } else {
              sidebendScore -= 40;
              currentFeedback.push("請左右傾斜身體進行體側彎");
            }
            currentPerfect = false;
          } else {
            sidebendScore -= Math.min(30, (bendAngle - 43) * 2.5);
            currentFeedback.push("側彎角度過大，請稍回正");
            currentPerfect = false;
          }

          // B. 手部上舉檢測 (25 分)
          if (bendDirection !== "直立") {
            if (isArmRaised) {
              // 合格
            } else {
              sidebendScore -= 25;
              currentFeedback.push(bendDirection === "向右側彎" ? "請將左手高舉過頭" : "請將右手高舉過頭");
              currentPerfect = false;
            }
          } else {
            sidebendScore -= 10;
          }

          // C. 骨盆移動穩定性 (20 分)
          if (hipShift < 0.08) {
            // 合格
          } else {
            sidebendScore -= 20;
            currentFeedback.push("骨盆請維持置中，不要左右晃動");
            currentPerfect = false;
          }

          // D. 身體前傾防旋轉檢測 (15 分)
          if (shoulderZDiff < 0.12) {
            // 合格
          } else {
            sidebendScore -= 15;
            currentFeedback.push("胸口請正對鏡頭，不要扭轉前傾");
            currentPerfect = false;
          }

          currentScore = Math.max(0, sidebendScore);

          // --- 15 幀穩定達標次數累計 ---
          const isPoseCorrect = currentScore >= 85 && (bendAngle >= 27 && bendAngle <= 43);

          if (isPoseCorrect && isCameraActive) {
            stableFrames++;
            repStatus.textContent = `Hold: ${stableFrames}/15`;
            repStatus.style.color = "var(--accent-yellow)";

            if (stableFrames === 15) {
              repsCount++;
              repDisplay.textContent = repsCount;
              repStatus.textContent = "PASS";
              repStatus.style.color = "var(--accent-green)";
              speakText(`側彎達標，第 ${repsCount} 下`);
              updateSaveButtonState();
            } else if (stableFrames > 15 && stableFrames % 30 === 0) {
              speakText("非常好，保持住");
            }
          } else {
            stableFrames = 0;
            repStatus.textContent = bendDirection;
            repStatus.style.color = "var(--text-secondary)";
          }

          // 即時語音矯正播報 (非維持狀態下)
          if (!currentPerfect && timeSec - lastRepTime > 2.0 && stableFrames === 0) {
            if (currentFeedback.length > 0) {
              speakText(currentFeedback[0]);
            }
          }

          // 更新指標元件數據
          metricSidebendAngle.textContent = `${bendAngle.toFixed(1)}°`;
          metricSidebendDirection.textContent = bendDirection;
          metricSidebendHipShift.textContent = hipShift.toFixed(2);
          metricSidebendArmStatus.textContent = armStatus;
        }
      }

      cachedState.score = currentScore;
      cachedState.feedback = currentFeedback;
      cachedState.perfect = currentPerfect;

      // Pushing to session scores for DB statistics
      if (isCameraActive && repState !== "neutral") {
        sessionScores.push(currentScore);
      }
    }
  } else {
    // 沒偵測到人體時，重設 Landmarks 快取
    cachedState.landmarks = null;
  }

      // ================= 繪圖渲染與 UI 更新 (保證每一幀都繪製以防止閃爍) =================
      updateDashboardUI();
      drawPoseSkeleton(h, w);

    } catch (error) {
      console.error("Error in detectionLoop:", error);
    }
  }

  // 遞迴呼叫下一幀
  animationFrameId = requestAnimationFrame(detectionLoop);
}

// ================= 介面繪製與 UI 更新 =================
function updateDashboardUI() {
  scoreDisplay.textContent = cachedState.score;
  scoreBar.style.width = `${cachedState.score}%`;
  
  // 動態調整分數顏色
  if (cachedState.score >= 85) {
    scoreDisplay.className = "stat-value text-glow-green";
    scoreBar.style.background = "linear-gradient(90deg, #10b981, #34d399)";
  } else if (cachedState.score >= 60) {
    scoreDisplay.className = "stat-value text-glow-blue";
    scoreBar.style.background = "linear-gradient(90deg, #3b82f6, #60a5fa)";
  } else {
    scoreDisplay.className = "stat-value";
    scoreDisplay.style.color = "var(--accent-red)";
    scoreDisplay.style.textShadow = "0 0 15px rgba(239, 68, 68, 0.5)";
    scoreBar.style.background = "linear-gradient(90deg, #ef4444, #f87171)";
  }

  // 完美徽章狀態
  if (cachedState.perfect && cachedState.landmarks) {
    posePerfectBadge.classList.add("visible");
  } else {
    posePerfectBadge.classList.remove("visible");
  }

  // 警示訊息更新
  if (!cachedState.landmarks) {
    feedbackList.innerHTML = `<div class="feedback-placeholder">未偵測到人體 skeleton，請站入鏡頭中央...</div>`;
  } else if (cachedState.feedback.length === 0) {
    feedbackList.innerHTML = `
      <div class="feedback-alert" style="background-color: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); color: #a7f3d0;">
        姿態相當完美，請繼續保持！
      </div>
    `;
  } else {
    feedbackList.innerHTML = cachedState.feedback
      .map(msg => `<div class="feedback-alert warning">${msg}</div>`)
      .join("");
  }
}

// 繪製骨架到 Canvas 上
function drawPoseSkeleton(canvasH, canvasW) {
  const lm = cachedState.landmarks;
  if (!lm) return;

  // 定義節點連線關係 (與 Python 原版對應)
  let connections = [];
  if (activeMode === "twist") {
    connections = [
      [LS_ID, RS_ID, "shoulder"], // 肩膀
      [LH_ID, RH_ID, "hip"],      // 臀部
      [LH_ID, LK_ID, "leg"],      // 左大腿
      [LK_ID, LA_ID, "leg"],      // 左小腿
      [RH_ID, RK_ID, "leg"],      // 右大腿
      [RK_ID, RA_ID, "leg"]       // 右小腿
    ];
  } else if (activeMode === "squat") {
    // 深蹲畫側身連線
    const squatSide = metricSquatSide.textContent;
    if (squatSide.includes("左側在前")) {
      connections = [
        [11, 23, "body"], // 肩至臀
        [23, 25, "leg"],  // 臀至膝
        [25, 27, "leg"],  // 膝至踝
        [11, 13, "arm"],  // 肩至肘
        [13, 15, "arm"]   // 肘至腕
      ];
    } else if (squatSide.includes("右側在前")) {
      connections = [
        [12, 24, "body"], // 肩至臀
        [24, 26, "leg"],  // 臀至膝
        [26, 28, "leg"],  // 膝至踝
        [12, 14, "arm"],  // 肩至肘
        [14, 16, "arm"]   // 肘至腕
      ];
    }
  } else if (activeMode === "sidebend") {
    // 體側彎畫正面連線與高舉的單側手臂
    const bendDir = metricSidebendDirection.textContent;
    connections = [
      [LS_ID, RS_ID, "shoulder"], // 肩膀
      [LH_ID, RH_ID, "hip"],      // 臀部
      [11, 23, "body"],           // 左軀幹
      [12, 24, "body"],           // 右軀幹
      [23, 25, "leg"],            // 左大腿
      [25, 27, "leg"],            // 左小腿
      [24, 26, "leg"],            // 右大腿
      [26, 28, "leg"]             // 右小腿
    ];

    if (bendDir.includes("向右側彎")) {
      connections.push([11, 13, "arm"], [13, 15, "arm"]);
    } else if (bendDir.includes("向左側彎")) {
      connections.push([12, 14, "arm"], [14, 16, "arm"]);
    } else {
      // 直立時繪製兩側手臂
      connections.push([11, 13, "arm"], [13, 15, "arm"], [12, 14, "arm"], [14, 16, "arm"]);
    }
  }

  // 1. 繪製骨架骨骼連線
  connections.forEach(([p1_idx, p2_idx, type]) => {
    const pt1 = lm[p1_idx];
    const pt2 = lm[p2_idx];
    
    if (pt1 && pt2) {
      ctx.beginPath();
      ctx.moveTo(pt1.x * canvasW, pt1.y * canvasH);
      ctx.lineTo(pt2.x * canvasW, pt2.y * canvasH);
      
      // 根據骨架類型設定發光霓虹線條
      if (type === "shoulder") {
        ctx.strokeStyle = "rgba(0, 255, 255, 0.8)";
        ctx.lineWidth = 4;
      } else if (type === "hip") {
        ctx.strokeStyle = "rgba(0, 255, 0, 0.8)";
        ctx.lineWidth = 4;
      } else {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
        ctx.lineWidth = 3;
      }
      ctx.shadowBlur = 4;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.stroke();
    }
  });
  
  // 恢復陰影設定，避免影響效能
  ctx.shadowBlur = 0;

  // 2. 標示關鍵關節點圓圈
  const keyJoints = activeMode === "twist" 
    ? [LS_ID, RS_ID, LH_ID, RH_ID, LK_ID, RK_ID, LA_ID, RA_ID]
    : (activeMode === "squat" 
      ? [11, 12, 23, 24, 25, 26, 27, 28, 13, 14, 15, 16]
      : [LS_ID, RS_ID, LH_ID, RH_ID, LK_ID, RK_ID, LA_ID, RA_ID, LW_ID, RW_ID]); // 體側彎加入雙手腕

  keyJoints.forEach(idx => {
    const pt = lm[idx];
    if (pt) {
      ctx.beginPath();
      ctx.arc(pt.x * canvasW, pt.y * canvasH, 6, 0, 2 * Math.PI);
      
      // 依據目前分數動態決定關節點發光顏色
      ctx.fillStyle = cachedState.score >= 85 ? "#10b981" : (cachedState.score >= 60 ? "#3b82f6" : "#ef4444");
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
}

// ================= 事件處理與模式切換 =================

// 切換教練模式
function switchMode(mode) {
  if (activeMode === mode) return;
  activeMode = mode;
  
  // 重設計數狀態
  repsCount = 0;
  repDisplay.textContent = repsCount;
  repState = "neutral";
  repStatus.textContent = "Neutral";
  repStatus.style.color = "var(--text-secondary)";
  angleBuffer.length = 0;
  ratioBuffer.length = 0;
  stableFrames = 0;
  sessionScores = [];
  sessionStartTime = Date.now();
  updateSaveButtonState();

  // DOM 可見性切換
  if (mode === "twist") {
    btnTwist.classList.add("active");
    btnSquat.classList.remove("active");
    btnSidebend.classList.remove("active");
    
    document.querySelectorAll(".twist-only").forEach(el => el.classList.remove("hidden"));
    document.querySelectorAll(".squat-only").forEach(el => el.classList.add("hidden"));
    document.querySelectorAll(".sidebend-only").forEach(el => el.classList.add("hidden"));
    
    guideTwist.classList.remove("hidden");
    guideSquat.classList.add("hidden");
    guideSidebend.classList.add("hidden");
    speakText("已切換為扭腰訓練模式");
  } else if (mode === "squat") {
    btnTwist.classList.remove("active");
    btnSquat.classList.add("active");
    btnSidebend.classList.remove("active");
    
    document.querySelectorAll(".twist-only").forEach(el => el.classList.add("hidden"));
    document.querySelectorAll(".squat-only").forEach(el => el.classList.remove("hidden"));
    document.querySelectorAll(".sidebend-only").forEach(el => el.classList.add("hidden"));
    
    guideTwist.classList.add("hidden");
    guideSquat.classList.remove("hidden");
    guideSidebend.classList.add("hidden");
    speakText("已切換為深蹲檢測模式，請轉向側面");
  } else if (mode === "sidebend") {
    btnTwist.classList.remove("active");
    btnSquat.classList.remove("active");
    btnSidebend.classList.add("active");
    
    document.querySelectorAll(".twist-only").forEach(el => el.classList.add("hidden"));
    document.querySelectorAll(".squat-only").forEach(el => el.classList.add("hidden"));
    document.querySelectorAll(".sidebend-only").forEach(el => el.classList.remove("hidden"));
    
    guideTwist.classList.add("hidden");
    guideSquat.classList.add("hidden");
    guideSidebend.classList.remove("hidden");
    speakText("已切換為體側彎檢測模式，請正面對相機");
  }
  
  if (activeUser) {
    updatePersonalizedCoachTip();
  }
}

// 相機鏡像調整
function handleMirrorToggle() {
  if (chkMirror.checked) {
    webcamElement.classList.add("mirror-y");
    canvasElement.classList.add("mirror-y");
  } else {
    webcamElement.classList.remove("mirror-y");
    canvasElement.classList.remove("mirror-y");
  }
}

// ================= 資料庫 API 串接與數據庫更新 =================

function updateSaveButtonState() {
  if (activeUser && repsCount > 0) {
    btnSaveSession.classList.remove("btn-disabled");
    btnSaveSession.disabled = false;
  } else {
    btnSaveSession.classList.add("btn-disabled");
    btnSaveSession.disabled = true;
  }
}

async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    const users = await res.json();
    
    userSelect.innerHTML = '<option value="" disabled selected>選擇使用者...</option>';
    users.forEach(user => {
      const opt = document.createElement('option');
      opt.value = user.id;
      opt.textContent = user.username;
      userSelect.appendChild(opt);
    });

    // Restore active user from localStorage
    const savedUserId = localStorage.getItem('fitness_active_user_id');
    if (savedUserId) {
      const exists = users.some(u => u.id == savedUserId);
      if (exists) {
        userSelect.value = savedUserId;
        selectUser(savedUserId);
      }
    }
  } catch (err) {
    console.error('載入使用者失敗:', err);
  }
}

async function selectUser(userId) {
  try {
    const res = await fetch('/api/users');
    const users = await res.json();
    const user = users.find(u => u.id == userId);
    if (user) {
      activeUser = user;
      localStorage.setItem('fitness_active_user_id', user.id);
      lblActiveUser.textContent = user.username;
      loadDashboardData(user.id);
      updateSaveButtonState();
    }
  } catch (err) {
    console.error('選擇使用者失敗:', err);
  }
}

async function handleCreateUser() {
  const username = txtNewUsername.value.trim();
  if (!username) {
    alert('請輸入姓名！');
    return;
  }
  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    const data = await res.json();
    if (res.status === 201) {
      txtNewUsername.value = '';
      newUserForm.classList.add('hidden');
      await loadUsers();
      // Select the newly created user
      userSelect.value = data.id;
      selectUser(data.id);
      speakText(`建立使用者 ${username} 成功`);
    } else {
      alert(data.error || '建立使用者失敗');
    }
  } catch (err) {
    console.error('建立使用者錯誤:', err);
    alert('建立使用者錯誤，請稍後再試。');
  }
}

async function loadDashboardData(userId) {
  try {
    // 1. Fetch stats
    const statsRes = await fetch(`/api/stats?user_id=${userId}`);
    const stats = await statsRes.json();
    userStats = stats; // store globally
    
    dbTotalWorkouts.textContent = stats.total_workouts;
    dbTotalReps.textContent = stats.total_reps;
    dbAvgScore.textContent = `${stats.avg_score}分`;

    // 2. Fetch history logs table
    const workoutsRes = await fetch(`/api/workouts?user_id=${userId}`);
    const workouts = await workoutsRes.json();
    
    renderHistoryTable(workouts);

    // 3. Render/Update Trend Chart
    renderTrendChart(stats.recent);

    // 4. Update coaching tip
    updatePersonalizedCoachTip();
  } catch (err) {
    console.error('載入儀表板數據失敗:', err);
  }
}

// ================= 個人化 AI 教練分析推薦系統 =================
function generatePersonalizedTip(stats, mode) {
  const modeStats = stats.by_mode[mode];
  if (!modeStats || modeStats.count === 0) {
    return {
      text: "這是你首次進行此項訓練，請跟隨下方的指導方針，保持穩定與規律的呼吸開始吧！",
      voice: "這是你首次進行此項訓練，請跟隨下方的指導方針，保持穩定與規律的呼吸開始吧！"
    };
  }

  const avg = modeStats.avg_score;
  const count = modeStats.count;
  
  // 篩選此模式的歷史紀錄以分析趨勢
  const modeRecent = stats.recent.filter(w => w.mode === mode);
  
  let trendText = "";
  let voiceText = "";

  if (modeRecent.length >= 2) {
    const last = modeRecent[modeRecent.length - 1].avg_score;
    const prev = modeRecent[modeRecent.length - 2].avg_score;
    if (last > prev + 4) {
      trendText = `📈 上次訓練動作比前一次進步了 ${Math.round(last - prev)} 分！做得很好！`;
      voiceText = `你上次的動作有明顯進步，做得很好！`;
    } else if (last < prev - 5) {
      trendText = `⚠️ 上次分數有所下滑，請特別注意姿勢維持。`;
      voiceText = `上次訓練分數有所下滑，今天請特別注意姿勢標準度。`;
    }
  }

  if (avg >= 88) {
    return {
      text: `歷史表現特優（平均 ${avg} 分，已完成 ${count} 次）。${trendText || "你的動作水準非常高，今天也請維持完美體態！"}`,
      voice: `你的歷史表現特優，平均分數達 ${avg} 分，今天請繼續維持完美體態！`
    };
  } else if (avg >= 70) {
    let focusMsg = "";
    if (mode === "twist") {
      focusMsg = "扭扭腰時請著重在「肩膀與骨盆保持水平」，避免歪斜。";
    } else if (mode === "squat") {
      focusMsg = "進行深蹲時請著重在「屁股往後坐，重心壓腳跟」。";
    } else if (mode === "sidebend") {
      focusMsg = "體側彎時請注意「骨盆置中」且「手臂拉直高舉過頭」。";
    }
    return {
      text: `表現穩定（平均 ${avg} 分，已完成 ${count} 次）。教練建議：${focusMsg} ${trendText}`,
      voice: `你目前平均分數為 ${avg} 分。教練建議：${focusMsg} ${voiceText}`
    };
  } else {
    let focusMsg = "";
    if (mode === "twist") {
      focusMsg = "扭腰幅度可能太大或速度過快，請放慢速度，專注在腰腹核心水平扭轉。";
    } else if (mode === "squat") {
      focusMsg = "深蹲重心容易前傾且深度不夠，請側身站立，重心往腳跟移動，蹲低至接近90度。";
    } else if (mode === "sidebend") {
      focusMsg = "體側彎時胸口請朝向正前方，不要扭轉，單臂高舉貼近耳朵側彎。";
    }
    return {
      text: `加油！目前平均 ${avg} 分。教練特訓重點：${focusMsg}`,
      voice: `加油！你目前平均分數為 ${avg} 分。教練特別建議：${focusMsg}`
    };
  }
}

function updatePersonalizedCoachTip() {
  if (!activeUser || !userStats) {
    personalizedCoachTip.classList.add("hidden");
    return;
  }

  const tip = generatePersonalizedTip(userStats, activeMode);
  coachTipText.textContent = tip.text;
  personalizedCoachTip.classList.remove("hidden");
  
  // 延遲撥報讓切換模式的 TTS 完成
  setTimeout(() => {
    speakText(tip.voice);
  }, 1500);
}

function renderHistoryTable(workouts) {
  if (workouts.length === 0) {
    historyTableBody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty">目前尚無訓練紀錄，請開始進行訓練！</td>
      </tr>
    `;
    return;
  }

  historyTableBody.innerHTML = workouts.map(w => {
    const date = new Date(w.created_at).toLocaleString('zh-TW', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    const modeName = readableModeNames[w.mode] || w.mode;
    const scoreClass = w.avg_score >= 85 ? 'text-glow-green' : (w.avg_score >= 60 ? 'text-glow-blue' : 'text-danger');
    return `
      <tr>
        <td>${date}</td>
        <td>${modeName}</td>
        <td>${w.reps}</td>
        <td><span class="${scoreClass}">${w.avg_score}分</span></td>
        <td>${w.duration_seconds}</td>
        <td>
          <button class="btn-delete-log" data-id="${w.id}" title="刪除紀錄">✕</button>
        </td>
      </tr>
    `;
  }).join('');

  // Attach delete listeners
  document.querySelectorAll('.btn-delete-log').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      if (confirm('確定要刪除這筆訓練紀錄嗎？')) {
        try {
          const res = await fetch(`/api/workouts/${id}`, { method: 'DELETE' });
          if (res.ok) {
            speakText('紀錄已刪除');
            loadDashboardData(activeUser.id);
          }
        } catch (err) {
          console.error('刪除訓練紀錄失敗:', err);
        }
      }
    });
  });
}

function renderTrendChart(recentWorkouts) {
  const ctxChart = document.getElementById('score-trend-chart').getContext('2d');
  
  // Destroy existing chart to avoid overlay issues
  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  if (!recentWorkouts || recentWorkouts.length === 0) {
    // Draw empty state
    trendChartInstance = new Chart(ctxChart, {
      type: 'line',
      data: {
        labels: ['無數據'],
        datasets: [{
          label: '動作分數',
          data: [0],
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } },
          x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8' } }
        }
      }
    });
    return;
  }

  const labels = recentWorkouts.map(w => {
    const d = new Date(w.created_at);
    return `${d.getMonth() + 1}/${d.getDate()} ${readableModeNames[w.mode] || w.mode}`;
  });
  const scores = recentWorkouts.map(w => w.avg_score);
  const reps = recentWorkouts.map(w => w.reps);

  trendChartInstance = new Chart(ctxChart, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '動作分數',
          data: scores,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          borderWidth: 3,
          tension: 0.3,
          fill: true,
          yAxisID: 'y'
        },
        {
          label: '動作次數 (Reps)',
          data: reps,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.05)',
          borderWidth: 2,
          borderDash: [5, 5],
          tension: 0.3,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          type: 'linear',
          position: 'left',
          min: 0,
          max: 100,
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94a3b8' }
        },
        y1: {
          type: 'linear',
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#94a3b8' }
        },
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94a3b8' }
        }
      },
      plugins: {
        legend: {
          labels: { color: '#f1f5f9' }
        }
      }
    }
  });
}

async function saveWorkoutSession() {
  if (!activeUser) {
    alert('請先選擇或新增使用者！');
    return;
  }
  if (repsCount === 0) {
    alert('請先開始動作偵測並完成至少一次訓練！');
    return;
  }

  // Calculate session stats
  const avgScore = sessionScores.length > 0
    ? Math.round(sessionScores.reduce((a, b) => a + b, 0) / sessionScores.length)
    : cachedState.score; // Fallback to current score
  const durationSeconds = sessionStartTime
    ? Math.round((Date.now() - sessionStartTime) / 1000)
    : 0;

  const payload = {
    user_id: activeUser.id,
    mode: activeMode,
    reps: repsCount,
    avg_score: avgScore,
    duration_seconds: durationSeconds
  };

  try {
    const res = await fetch('/api/workouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      // Speak success message
      speakText(`訓練成功儲存！共完成 ${repsCount} 下，平均 ${avgScore} 分`);

      // Populate and show success modal
      modalSummaryMode.textContent = readableModeNames[activeMode] || activeMode;
      modalSummaryReps.textContent = `${repsCount} 下`;
      modalSummaryScore.textContent = `${avgScore} 分`;
      saveSuccessModal.classList.remove('hidden');

      // Reset trackers for the next session
      repsCount = 0;
      repDisplay.textContent = repsCount;
      sessionScores = [];
      sessionStartTime = Date.now(); // reset start timer
      updateSaveButtonState();

      // Refresh database dashboard
      loadDashboardData(activeUser.id);
    } else {
      alert('儲存訓練紀錄失敗，請確認伺服器狀態。');
    }
  } catch (err) {
    console.error('儲存訓練錯誤:', err);
    alert('儲存訓練錯誤，請確認網路連線是否正常。');
  }
}

// 綁定事件監聽
btnToggleCamera.addEventListener("click", toggleCamera);
chkMirror.addEventListener("change", handleMirrorToggle);
btnTwist.addEventListener("click", () => switchMode("twist"));
btnSquat.addEventListener("click", () => switchMode("squat"));
btnSidebend.addEventListener("click", () => switchMode("sidebend"));

// 網頁準備就緒後啟動
function initApp() {
  handleMirrorToggle();
  // 禁用開機按鈕直到模型載入完畢
  btnToggleCamera.classList.add("btn-disabled");
  btnToggleCamera.disabled = true;
  initPoseModel();

  // Load database users
  loadUsers();

  // New events for Database features
  userSelect.addEventListener('change', (e) => selectUser(e.target.value));
  btnShowAddUser.addEventListener('click', () => {
    newUserForm.classList.remove('hidden');
    txtNewUsername.focus();
  });
  btnCancelUser.addEventListener('click', () => {
    newUserForm.classList.add('hidden');
    txtNewUsername.value = '';
  });
  btnCreateUser.addEventListener('click', handleCreateUser);
  btnSaveSession.addEventListener('click', saveWorkoutSession);
  btnCloseModal.addEventListener('click', () => {
    saveSuccessModal.classList.add('hidden');
  });
}

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

// 當離開頁面時自動清理資源
window.addEventListener("beforeunload", () => {
  stopCamera();
});
