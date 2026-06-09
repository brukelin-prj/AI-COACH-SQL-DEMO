// --- 前端核心控制與 AI 判定邏輯 (app.js - 獨立小節重構版) ---

// --- 狀態機定義 ---
const STATE_LOGIN = 'login';
const STATE_MENU = 'menu';
const STATE_WORKOUT = 'workout';
let currentAppState = STATE_LOGIN;

// --- 全域變數 ---
let currentUser = null;
let currentStageIndex = 0; // 當前所選節次 (0-8)
let currentScore = 0;
let currentBeat = 0;
let currentSection = 1;

// 儲存當前小節的得分與偵測次數，用於計算該小節平均分數
let stageScores = [];
let stageStartTime = 0;

// 評分平滑化與更新頻率限制
let smoothedMatchPct = 0;
let lastUiUpdateTime = 0;

// 自適應 AI 閥值 (從後端獲取，預設寬鬆值)
let configThresholds = {
    squat_tolerance: 15.0,
    arm_tolerance: 15.0,
    twist_tolerance: 15.0
};

// 8式動作名稱與指引
const STAGES = [
    { name: "預備動作", camera: "正面", desc: "兩手插腰，雙腳併攏，跟隨音樂預備起！" },
    { name: "第一節：下肢全深蹲", camera: "側面", desc: "背部挺直，進行全蹲（膝關節彎曲角度需小於 100 度）" },
    { name: "第二節：下肢半深蹲", camera: "側面", desc: "膝蓋微彎進行半深蹲（膝關節夾角介於 110-140 度）" },
    { name: "第三節：上肢向上伸展", camera: "正面", desc: "雙手向上高舉過頭，伸直手肘" },
    { name: "第四節：擴胸轉體", camera: "正面", desc: "雙手前平舉 -> 一手搭對肩、另一臂水平向後拉轉體" },
    { name: "第五節：體側左右彎曲", camera: "正面", desc: "雙手高舉，身體隨節奏交替往左、右側彎" },
    { name: "第六節：前後彎體", camera: "側面", desc: "前彎下探觸地 -> 隨後雙手插腰身體微幅後仰" },
    { name: "第七節：四肢協調伸展", camera: "正面", desc: "雙腳跳開/開立，雙手向兩側平展或向上揚起" },
    { name: "第八節：呼吸整理運動", camera: "正面", desc: "配合呼吸，雙手慢速上下平舉揮動" }
];

// --- 幾何工具函式 ---
function getAngle(p1, p2, p3) {
    if (!p1 || !p2 || !p3) return 180;
    
    const v1 = { x: p1.x - p2.x, y: p1.y - p2.y };
    const v2 = { x: p3.x - p2.x, y: p3.y - p2.y };
    
    const dotProduct = v1.x * v2.x + v1.y * v2.y;
    const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
    const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
    
    if (len1 === 0 || len2 === 0) return 180;
    
    const cosAngle = Math.max(-1.0, Math.min(1.0, dotProduct / (len1 * len2)));
    const angle = Math.acos(cosAngle);
    return angle * (180 / Math.PI); // 回傳 0-180 度
}

// --- DOM 元素 ---
const authModal = document.getElementById("auth-modal");
const btnPower = document.getElementById("btn-power");
const powerLed = document.getElementById("power-led");

// 螢幕容器切換
const tvMenuScreen = document.getElementById("tv-menu-screen");
const tvWorkoutScreen = document.getElementById("tv-workout-screen");
const btnBackToMenu = document.getElementById("btn-back-to-menu");
const workoutBeatProgress = document.getElementById("workout-beat-progress");

// LED 儀表板與回饋
const ledStage = document.getElementById("led-stage");
const ledActionName = document.getElementById("led-action-name");
const ledMatchPct = document.getElementById("led-match-pct");
const ledScore = document.getElementById("led-score");
const ledCamDir = document.getElementById("led-cam-dir");
const feedbackText = document.getElementById("feedback-text");
const feedbackSmiley = document.getElementById("feedback-smiley");
const matchBar = document.getElementById("match-bar");
const poseWarning = document.getElementById("pose-warning");

// 畫布與影像
const videoElement = document.getElementById("webcam");
const canvasPlayer = document.getElementById("canvas-player");
const ctxPlayer = canvasPlayer.getContext("2d");
const canvasCoach = document.getElementById("canvas-coach");
const ctxCoach = canvasCoach.getContext("2d");

// 旋鈕
const knobChannel = document.getElementById("knob-channel");
const knobVolume = document.getElementById("knob-volume");

// --- 初始化 MediaPipe Pose 與 Camera (動態建立/銷毀) ---
let pose = null;
let camera = null;
let isTVOn = false;
let lastFrameTime = 0;

function initPoseDetection() {
    console.log("Dynamically initializing MediaPipe Pose Engine...");
    pose = new Pose({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
    });

    pose.setOptions({
        modelComplexity: 0, // 0: Lite 模式，極低 RAM 佔用，適合低階行動端
        smoothLandmarks: true,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5
    });

    pose.onResults(onPoseResults);
}

// --- 會員系統對接 (FastAPI API) ---
const API_BASE = ""; // 本地相對路徑

// 會員註冊
document.getElementById("btn-register").addEventListener("click", async () => {
    const username = document.getElementById("reg-username").value.trim();
    const password = document.getElementById("reg-password").value.trim();
    const age = parseInt(document.getElementById("reg-age").value);
    const gender = document.getElementById("reg-gender").value;
    const height = parseFloat(document.getElementById("reg-height").value);
    const weight = parseFloat(document.getElementById("reg-weight").value);

    if (!username || !password) {
        alert("請輸入帳號密碼！");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/register`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password, age, height, weight, gender })
        });
        const data = await res.json();
        if (res.ok) {
            alert("註冊成功！系統將自動為您登入。");
            performLogin(username, password);
        } else {
            alert(`註冊失敗: ${data.detail}`);
        }
    } catch (e) {
        alert("伺服器連線失敗");
    }
});

// 會員登入
document.getElementById("btn-login").addEventListener("click", () => {
    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-password").value.trim();
    if (!username || !password) {
        alert("請輸入帳號密碼！");
        return;
    }
    performLogin(username, password);
});

// 切換表單
document.getElementById("go-to-register").addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("login-section").classList.add("hidden");
    document.getElementById("register-section").classList.remove("hidden");
});

document.getElementById("go-to-login").addEventListener("click", (e) => {
    e.preventDefault();
    document.getElementById("register-section").classList.add("hidden");
    document.getElementById("login-section").classList.remove("hidden");
});

async function performLogin(username, password) {
    try {
        const res = await fetch(`${API_BASE}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            currentUser = data.user;
            authModal.classList.add("hidden");
            alert(`歡迎回來，${currentUser.username}！`);
            currentAppState = STATE_MENU;
            loadUserDashboard();
            if (isTVOn) {
                showMenuScreen();
            }
        } else {
            alert(`登入失敗: ${data.detail}`);
        }
    } catch (e) {
        alert("伺服器連線失敗");
    }
}

// 登入後載入相關統計、動作最高分與動態閾值
async function loadUserDashboard() {
    if (!currentUser) return;
    
    // 初始化 High Scores 顯示
    for (let i = 0; i <= 8; i++) {
        const cardScore = document.getElementById(`high-score-${i}`);
        if (cardScore) cardScore.textContent = "HI: --";
    }

    // 1. 獲取個人歷史紀錄與高分
    try {
        const res = await fetch(`${API_BASE}/api/user_stats?user_id=${currentUser.id}`);
        const data = await res.json();
        if (res.ok) {
            // 更新底部表格
            const tbody = document.getElementById("stats-body");
            tbody.innerHTML = "";
            if (data.summary.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" class="text-center">尚無運動紀錄，請點選上方卡片開始練習！</td></tr>`;
            } else {
                data.summary.forEach(row => {
                    const tr = document.createElement("tr");
                    tr.innerHTML = `
                        <td>${row.movement_name}</td>
                        <td>${Math.round(row.avg_score)}% (HI: ${Math.round(row.max_score)}%)</td>
                        <td>${row.sessions}次</td>
                        <td>${row.total_duration}秒</td>
                    `;
                    tbody.appendChild(tr);

                    // 同步更新關卡選單上的 High Score (HI)
                    const cardScore = document.getElementById(`high-score-${row.movement_index}`);
                    if (cardScore) {
                        cardScore.textContent = `HI: ${Math.round(row.max_score)}%`;
                    }
                });
            }
        }
    } catch (e) {
        console.error("無法取得歷史統計資料:", e);
    }

    // 2. 獲取自適應 AI 閥值
    try {
        const res = await fetch(`${API_BASE}/api/thresholds?age=${currentUser.age}`);
        const data = await res.json();
        if (res.ok) {
            configThresholds.squat_tolerance = data.squat_tolerance;
            configThresholds.arm_tolerance = data.arm_tolerance;
            configThresholds.twist_tolerance = data.twist_tolerance;
            
            document.getElementById("ai-group").textContent = data.group === "age_60+" ? "長青優化組 (60歲+)" : (data.group === "age_under_18" ? "青春精準組 (<18歲)" : "一般標準組");
            document.getElementById("t-val-squat").textContent = `±${data.squat_tolerance}°`;
            document.getElementById("t-val-arm").textContent = `±${data.arm_tolerance}°`;
            document.getElementById("t-val-twist").textContent = `±${data.twist_tolerance}°`;
        }
    } catch (e) {
        console.error("無法取得自適應閥值:", e);
    }
}

// 分節運動數據上傳
async function uploadStageResult(stageIndex, avgScore) {
    if (!currentUser) return;
    const duration = Math.round((Date.now() - stageStartTime) / 1000);
    try {
        await fetch(`${API_BASE}/api/upload_segment`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                user_id: currentUser.id,
                movement_index: stageIndex,
                movement_name: STAGES[stageIndex].name,
                match_score: avgScore,
                duration_sec: duration
            })
        });
        console.log(`Uploaded stage ${stageIndex} score: ${avgScore}%`);
        // 上傳後自動重新整理面板的統計與 High Score
        loadUserDashboard();
    } catch (e) {
        console.error("數據上傳失敗", e);
    }
}

// --- 電視開關與選單切換控制 ---

btnPower.addEventListener("click", () => {
    if (!currentUser) {
        alert("請先完成登入！");
        return;
    }
    togglePower();
});

function togglePower() {
    isTVOn = !isTVOn;
    if (isTVOn) {
        powerLed.classList.add("on");
        document.getElementById("main-screen").style.filter = "none";
        
        // 進入動作選擇主選單
        showMenuScreen();
    } else {
        powerLed.classList.remove("on");
        // 關機特效
        document.getElementById("main-screen").style.filter = "brightness(0) contrast(0)";
        
        // 銷毀所有正在進行的練習資源，釋放相機與模型記憶體
        stopWorkoutAndRelease();
        tvMenuScreen.classList.add("hidden");
        tvWorkoutScreen.classList.add("hidden");
    }
}

// 顯示動作選擇選單
function showMenuScreen() {
    currentAppState = STATE_MENU;
    tvWorkoutScreen.classList.add("hidden");
    tvMenuScreen.classList.remove("hidden");
    
    // 旋鈕歸零 (預備)
    knobChannel.style.transform = "rotate(0deg)";
}

// 設定主選單關卡卡片的點擊事件
document.querySelectorAll(".stage-card").forEach(card => {
    card.addEventListener("click", () => {
        if (!isTVOn || currentAppState !== STATE_MENU) return;
        
        const stageIndex = parseInt(card.getAttribute("data-stage"));
        currentStageIndex = stageIndex;
        window.currentStageIndex = stageIndex; // 提供 synth.js 讀取
        
        // 切換至鍛鍊畫面
        currentAppState = STATE_WORKOUT;
        tvMenuScreen.classList.add("hidden");
        tvWorkoutScreen.classList.remove("hidden");

        // 旋轉 Channel 旋鈕作為開關特效
        knobChannel.style.transform = `rotate(${stageIndex * 40}deg)`;

        // 啟動相機、AI 與音樂
        startWorkout();
    });
});

// 點擊返回選單按鈕
btnBackToMenu.addEventListener("click", () => {
    if (currentAppState === STATE_WORKOUT) {
        stopWorkoutAndRelease();
        showMenuScreen();
    }
});

// 音量旋鈕拖曳控制
let isDraggingVolume = false;
knobVolume.addEventListener("mousedown", (e) => { isDraggingVolume = true; });
document.addEventListener("mouseup", () => { isDraggingVolume = false; });
document.addEventListener("mousemove", (e) => {
    if (isDraggingVolume && isTVOn) {
        const rect = knobVolume.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * (180 / Math.PI);
        knobVolume.style.transform = `rotate(${angle}deg)`;
        
        let vol = (angle + 180) / 360;
        window.gymSynth.setVolume(vol);
    }
});

// --- 動態相機與 AI 資源管理 (核心優化) ---

function startWorkout() {
    // 1. 動態初始化 MediaPipe Pose (若先前已釋放為 null)
    if (!pose) {
        initPoseDetection();
    }

    // 2. 啟動鏡頭串流
    startWebcam();

    // 3. 初始化數據與時間
    currentScore = 0;
    currentBeat = 0;
    currentSection = 1;
    stageScores = [];
    stageStartTime = Date.now();
    smoothedMatchPct = 0;
    lastUiUpdateTime = 0;

    updateUIForStage();
    workoutBeatProgress.textContent = "BEATS: 0/16";

    // 4. 啟動音樂伴奏與口令
    window.gymSynth.start();
}

function stopWorkoutAndRelease() {
    // 1. 停止音樂播放
    window.gymSynth.stop();

    // 2. 停止並關閉鏡頭，釋放影像緩衝區
    stopWebcam();

    // 3. 徹底銷毀 MediaPipe Pose 實例以釋放 WebGL 與 WASM 核心記憶體 (重要！)
    if (pose) {
        console.log("Tearing down MediaPipe Pose Engine to free RAM...");
        try {
            pose.close();
        } catch (e) {
            console.error("Error closing Pose engine:", e);
        }
        pose = null; // 設為 null 供垃圾回收 (Garbage Collection)
    }

    // 4. 重設前端 UI 文字與進度條
    ledMatchPct.textContent = "0%";
    ledMatchPct.className = "led-val";
    ledScore.textContent = "000000";
    matchBar.style.width = "0%";
    poseWarning.classList.add("hidden");
    
    // 清除畫布
    ctxPlayer.clearRect(0, 0, canvasPlayer.width, canvasPlayer.height);
    ctxCoach.clearRect(0, 0, canvasCoach.width, canvasCoach.height);
}

function startWebcam() {
    // 設定畫布與畫面的寬高
    canvasPlayer.width = canvasPlayer.parentElement.clientWidth;
    canvasPlayer.height = 360;
    canvasCoach.width = canvasCoach.parentElement.clientWidth;
    canvasCoach.height = 360;

    // 將鏡頭寬高設定為 320x240 (減半解析度，大幅節省視訊緩衝區 RAM)
    camera = new Camera(videoElement, {
        onFrame: async () => {
            if (isTVOn && currentAppState === STATE_WORKOUT) {
                const now = Date.now();
                // 節流 (Throttle)：限制每 150ms 運算一次 (約 6.6 FPS)
                // 6.6 FPS 在 60 BPM 健康操下足夠精確，且可降低 80% 的手機 CPU/GPU 與記憶體耗損！
                if (now - lastFrameTime > 150) {
                    lastFrameTime = now;
                    if (pose) {
                        await pose.send({ image: videoElement });
                    }
                }
            }
        },
        width: 320,
        height: 240
    });
    
    camera.start().catch(err => {
        alert("相機開啟失敗，請確認是否已被其他程式佔用或未允許權限！");
        stopWorkoutAndRelease();
        showMenuScreen();
    });
}

function stopWebcam() {
    if (camera) {
        console.log("Stopping Webcam stream...");
        try {
            camera.stop();
        } catch (e) {
            console.error("Error stopping camera:", e);
        }
        camera = null;
    }
}

// --- 節拍事件同步與自動結束 (onGymBeat) ---
window.currentStageIndex = 0;
window.onGymBeat = function(beatCount, sectionCount) {
    if (!isTVOn || currentAppState !== STATE_WORKOUT) return;
    
    currentBeat = beatCount;
    currentSection = sectionCount;

    const totalBeatsInStage = 16;
    const currentProgressBeat = (sectionCount - 1) * 8 + beatCount;
    
    // 更新介面節拍數
    workoutBeatProgress.textContent = `BEATS: ${currentProgressBeat}/16`;
    ledStage.textContent = `${currentStageIndex}/8`;
    
    // 當前操節完成 (16 拍結束)
    if (currentProgressBeat === totalBeatsInStage) {
        // 1. 計算小節平均分數
        let avgScore = 0;
        if (stageScores.length > 0) {
            avgScore = stageScores.reduce((a, b) => a + b, 0) / stageScores.length;
        }
        avgScore = Math.min(100, Math.round(avgScore));
        
        // 2. 播放換節哨音
        window.gymSynth.playWhistle();

        // 3. 停止音樂，銷毀相機與 AI 模型，徹底釋放手機記憶體
        stopWorkoutAndRelease();

        // 4. 上傳分節數據到後台資料庫
        uploadStageResult(currentStageIndex, avgScore);

        // 5. 提示使用者運動結果，並回到選單
        setTimeout(() => {
            alert(`【鍛鍊完成】\n操節：${STAGES[currentStageIndex].name}\n本次動作平均匹配率：${avgScore}%！\n\n數據已儲存，優化閾值已更新！`);
            showMenuScreen();
        }, 300);
    }
};

function updateUIForStage() {
    const stage = STAGES[currentStageIndex];
    ledStage.textContent = `${currentStageIndex}/8`;
    ledActionName.textContent = stage.name;
    ledCamDir.textContent = stage.camera;
    feedbackText.textContent = stage.desc;
    feedbackSmiley.textContent = "😃";
}

// --- 姿態偵測回調 (繪圖與比對) ---
function onPoseResults(results) {
    if (!isTVOn || currentAppState !== STATE_WORKOUT) return;

    ctxPlayer.save();
    ctxPlayer.clearRect(0, 0, canvasPlayer.width, canvasPlayer.height);
    
    // 水平翻轉影像以利鏡像操作
    ctxPlayer.translate(canvasPlayer.width, 0);
    ctxPlayer.scale(-1, 1);
    ctxPlayer.drawImage(results.image, 0, 0, canvasPlayer.width, canvasPlayer.height);
    
    if (results.poseLandmarks) {
        ctxPlayer.lineWidth = 4;
        ctxPlayer.strokeStyle = "#39ff14";
        
        // 偵測是否為行動裝置，行動端關閉陰影發光以節省 GPU RAM 與運算
        const isMobile = /Mobi|Android|iPhone/i.test(navigator.userAgent);
        if (!isMobile) {
            ctxPlayer.shadowColor = "#39ff14";
            ctxPlayer.shadowBlur = 10;
        } else {
            ctxPlayer.shadowBlur = 0;
        }

        drawSkeleton(ctxPlayer, results.poseLandmarks, canvasPlayer.width, canvasPlayer.height);
        evaluatePose(results.poseLandmarks);
    } else {
        ledMatchPct.textContent = "0%";
        ledMatchPct.className = "led-val text-red";
        matchBar.style.width = "0%";
        feedbackText.textContent = "找不到人影，請退後並確保全身在鏡頭內！";
        feedbackSmiley.textContent = "🤔";
        smoothedMatchPct = 0;
    }
    
    ctxPlayer.restore();

    // 繪製右側 AI 數位教練
    drawCoachScreen();
}

// 繪製骨架的輔助函數
function drawSkeleton(ctx, landmarks, w, h) {
    const connections = [
        [11, 12], [11, 23], [12, 24], [23, 24], 
        [11, 13], [13, 15], [12, 14], [14, 16], 
        [23, 25], [25, 27], [24, 26], [26, 28]  
    ];

    connections.forEach(([p1, p2]) => {
        const pt1 = landmarks[p1];
        const pt2 = landmarks[p2];
        if (pt1 && pt2 && pt1.visibility > 0.5 && pt2.visibility > 0.5) {
            ctx.beginPath();
            ctx.moveTo(pt1.x * w, pt1.y * h);
            ctx.lineTo(pt2.x * w, pt2.y * h);
            ctx.stroke();
        }
    });

    ctx.fillStyle = "#fff";
    ctx.shadowBlur = 0;
    const joints = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
    joints.forEach(j => {
        const pt = landmarks[j];
        if (pt && pt.visibility > 0.5) {
            ctx.beginPath();
            ctx.arc(pt.x * w, pt.y * h, 5, 0, 2 * Math.PI);
            ctx.fill();
        }
    });
}

// --- 8式健康操動作判定邏輯 (Heuristic Evaluation) ---
function evaluatePose(landmarks) {
    const stage = STAGES[currentStageIndex];
    
    if (stage.camera === "側面") {
        const ls = landmarks[11];
        const rs = landmarks[12];
        const shoulderGap = Math.abs(ls.x - rs.x);
        if (shoulderGap > 0.15) {
            poseWarning.classList.remove("hidden");
            poseWarning.textContent = "請轉向側身！";
            ledMatchPct.textContent = "0%";
            ledMatchPct.className = "led-val text-red";
            matchBar.style.width = "0%";
            feedbackText.textContent = "此動作需檢測側身骨架，請往左/右轉身 90 度！";
            smoothedMatchPct = 0;
            return;
        } else {
            poseWarning.classList.add("hidden");
        }
    } else {
        poseWarning.classList.add("hidden");
    }

    const lElbowAng = getAngle(landmarks[11], landmarks[13], landmarks[15]);
    const rElbowAng = getAngle(landmarks[12], landmarks[14], landmarks[16]);
    const lKneeAng = getAngle(landmarks[23], landmarks[25], landmarks[27]);
    const rKneeAng = getAngle(landmarks[24], landmarks[26], landmarks[28]);
    
    let matchPct = 0;
    let feedback = "";
    let smiley = "😐";

    const squatTol = configThresholds.squat_tolerance;
    const armTol = configThresholds.arm_tolerance;
    const twistTol = configThresholds.twist_tolerance;

    switch (currentStageIndex) {
        case 0: // 預備動作：兩手插腰
            const lWristHipDist = Math.abs(landmarks[15].y - landmarks[23].y);
            const rWristHipDist = Math.abs(landmarks[16].y - landmarks[24].y);
            if (lWristHipDist < 0.15 && rWristHipDist < 0.15) {
                matchPct = 100;
                feedback = "完美預備！請跟隨音樂節拍...";
                smiley = "😃";
            } else {
                matchPct = 30;
                feedback = "請將雙手手腕插在腰際側邊！";
                smiley = "😐";
            }
            break;

        case 1: // 第一節：下肢運動 (全深蹲)
            const squatAngle = Math.min(lKneeAng, rKneeAng);
            if (squatAngle < 100 + squatTol) {
                matchPct = 100;
                feedback = "非常棒的全深蹲動作！核心收緊。";
                smiley = "😎";
            } else if (squatAngle < 135) {
                matchPct = 60;
                feedback = "蹲得不夠深喔，試著再蹲低一點！";
                smiley = "😐";
            } else {
                matchPct = 10;
                feedback = "請跟著節拍下蹲！背部打直。";
                smiley = "😢";
            }
            break;

        case 2: // 第二節：下肢運動 (半深蹲)
            const halfSquatAngle = Math.min(lKneeAng, rKneeAng);
            if (110 - squatTol <= halfSquatAngle && halfSquatAngle <= 140 + squatTol) {
                matchPct = 100;
                feedback = "標準的半深蹲動作！保持膝蓋穩定。";
                smiley = "😃";
            } else if (halfSquatAngle < 110) {
                matchPct = 40;
                feedback = "蹲得太低了，此小節為半深蹲！";
                smiley = "😐";
            } else {
                matchPct = 15;
                feedback = "請配合拍子微蹲，膝蓋朝前。";
                smiley = "😢";
            }
            break;

        case 3: // 第三節：上肢運動 (向上伸展)
            const lWristSh = landmarks[15].y < landmarks[11].y;
            const rWristSh = landmarks[16].y < landmarks[12].y;
            const armStraight = (lElbowAng > 180 - armTol && rElbowAng > 180 - armTol);
            if (lWristSh && rWristSh && armStraight) {
                matchPct = 100;
                feedback = "雙臂完全伸展！做得很好。";
                smiley = "😎";
            } else if (lWristSh && rWristSh) {
                matchPct = 60;
                feedback = "手高舉了，但請手肘盡量伸直！";
                smiley = "😐";
            } else {
                matchPct = 20;
                feedback = "請雙手高舉過頭！";
                smiley = "😢";
            }
            break;

        case 4: // 第四節：擴胸轉體 (胸腰旋轉)
            const isRightTwist = (currentProgressBeat >= 3 && currentProgressBeat <= 6) || (currentProgressBeat >= 11 && currentProgressBeat <= 14);
            
            if (isRightTwist) {
                const isLeftHandOnRightShoulder = Math.abs(landmarks[15].x - landmarks[12].x) < 0.15;
                const isRightArmOpen = rElbowAng > 140;
                if (isLeftHandOnRightShoulder && isRightArmOpen) {
                    matchPct = 100;
                    feedback = "轉體幅度非常標準！充分伸展胸背。";
                    smiley = "😎";
                } else {
                    matchPct = 40;
                    feedback = "一手搭對肩，另一手水平向後打開！";
                    smiley = "😐";
                }
            } else {
                const isHandsForward = landmarks[15].y < landmarks[11].y + 0.1 && landmarks[16].y < landmarks[12].y + 0.1;
                if (isHandsForward) {
                    matchPct = 100;
                    feedback = "雙手平舉預備... 隨後轉體！";
                    smiley = "😃";
                } else {
                    matchPct = 30;
                    feedback = "雙腳開立與肩同寬，雙手平舉預備。";
                    smiley = "😐";
                }
            }
            break;

        case 5: // 第五節：體側左右彎曲 (體側)
            const shSlope = Math.abs(landmarks[11].y - landmarks[12].y) / Math.abs(landmarks[11].x - landmarks[12].x);
            const targetSlope = Math.tan(15 * Math.PI / 180);
            if (shSlope > targetSlope) {
                matchPct = 100;
                feedback = "側彎角度足夠！感受腰部拉伸。";
                smiley = "😃";
            } else {
                matchPct = 30;
                feedback = "請隨節奏將身體大幅度往左右側彎！";
                smiley = "😐";
            }
            break;

        case 6: // 第六節：前後彎體 (前後彎曲 - 需側身)
            const isBendingForward = (currentProgressBeat >= 2 && currentProgressBeat <= 5) || (currentProgressBeat >= 10 && currentProgressBeat <= 13);
            if (isBendingForward) {
                const handBelowKnee = landmarks[15].y > landmarks[25].y && landmarks[16].y > landmarks[26].y;
                if (handBelowKnee) {
                    matchPct = 100;
                    feedback = "非常棒的前彎！手指盡量觸地。";
                    smiley = "😎";
                } else {
                    matchPct = 50;
                    feedback = "再彎腰向下深探，盡量伸展後腿肌！";
                    smiley = "😐";
                }
            } else {
                const isLeaningBack = landmarks[11].x < landmarks[23].x - 0.05; // 假設面右
                if (isLeaningBack) {
                    matchPct = 100;
                    feedback = "標準後仰！手插腰部。";
                    smiley = "😃";
                } else {
                    matchPct = 40;
                    feedback = "直立回到原位，或手插腰向後微仰！";
                    smiley = "😐";
                }
            }
            break;

        case 7: // 第七節：四肢運動 (協調開合)
            const shoulderW = Math.abs(landmarks[11].x - landmarks[12].x);
            const ankleW = Math.abs(landmarks[27].x - landmarks[28].x);
            const armOpen = landmarks[15].y < landmarks[11].y + 0.1 && landmarks[16].y < landmarks[12].y + 0.1;
            if (ankleW > shoulderW * 1.5 && armOpen) {
                matchPct = 100;
                feedback = "開合跳躍協調完美！";
                smiley = "😎";
            } else {
                matchPct = 45;
                feedback = "踏步開展雙腳，手平平展開！";
                smiley = "😐";
            }
            break;

        case 8: // 第八節：整理運動 (深呼吸緩和)
            const isHandsRaising = (currentProgressBeat % 8) < 4;
            const handsUp = landmarks[15].y < landmarks[11].y;
            const handsDown = landmarks[15].y > landmarks[11].y + 0.2;
            if ((isHandsRaising && handsUp) || (!isHandsRaising && handsDown)) {
                matchPct = 100;
                feedback = "深吸氣... 緩緩吐氣，調整呼吸。";
                smiley = "😃";
            } else {
                matchPct = 50;
                feedback = "跟隨教練動作慢速上下揮臂深呼吸。";
                smiley = "😐";
            }
            break;
    }

    matchPct = Math.round(matchPct);
    stageScores.push(matchPct);

    // 套用指數移動平均 (EMA) 來平滑化數值跳動
    if (stageScores.length === 1) {
        smoothedMatchPct = matchPct;
    } else {
        // 0.25 的權重可以在約 4 幀內平滑過渡，既保留即時性又大幅降低抖動
        smoothedMatchPct = 0.25 * matchPct + 0.75 * smoothedMatchPct;
    }
    const displayScore = Math.round(smoothedMatchPct);

    // 匹配進度條保持即時平滑更新 (維持畫面的流暢反應)
    matchBar.style.width = `${displayScore}%`;

    // 節流：控制評分文字與色彩每 500ms 僅更新一次，徹底解決字體閃爍難以辨識問題
    const now = Date.now();
    if (now - lastUiUpdateTime > 500) {
        lastUiUpdateTime = now;
        ledMatchPct.textContent = `${displayScore}%`;
        
        // 評分數字：紅色代表不及格(<60)，綠色代表及格(>=60)
        if (displayScore < 60) {
            ledMatchPct.className = "led-val text-red";
        } else {
            ledMatchPct.className = "led-val text-green";
        }
    }

    feedbackText.textContent = feedback;
    feedbackSmiley.textContent = smiley;

    if (matchPct > 70) {
        currentScore += Math.round(matchPct / 10);
        ledScore.textContent = String(currentScore).padStart(6, '0');
        
        if (Math.random() < 0.05) {
            window.gymSynth.playScoreSound();
        }
    }
}

// --- 繪製 AI 數位教練 (Coach Screen Animation) ---
function drawCoachScreen() {
    ctxCoach.save();
    ctxCoach.clearRect(0, 0, canvasCoach.width, canvasCoach.height);
    
    // 1. 繪製復古背景網格
    ctxCoach.strokeStyle = "#1a2420";
    ctxCoach.lineWidth = 1;
    const gridSpacing = 20;
    for (let x = 0; x < canvasCoach.width; x += gridSpacing) {
        ctxCoach.beginPath();
        ctxCoach.moveTo(x, 0);
        ctxCoach.lineTo(x, canvasCoach.height);
        ctxCoach.stroke();
    }
    for (let y = 0; y < canvasCoach.height; y += gridSpacing) {
        ctxCoach.beginPath();
        ctxCoach.moveTo(0, y);
        ctxCoach.lineTo(canvasCoach.width, y);
        ctxCoach.stroke();
    }

    // 2. 依據當前小節與節拍，推算教練的骨架座標
    const coachPose = getCoachKeyframes(currentStageIndex, currentBeat, currentSection);
    
    // 3. 繪製教練 (粉紅霓虹骨架)
    ctxCoach.lineWidth = 6;
    ctxCoach.strokeStyle = "#ff007f";
    
    // 行動端關閉教練陰影發光
    const isMobileCoach = /Mobi|Android|iPhone/i.test(navigator.userAgent);
    if (!isMobileCoach) {
        ctxCoach.shadowColor = "#ff007f";
        ctxCoach.shadowBlur = 12;
    } else {
        ctxCoach.shadowBlur = 0;
    }

    const w = canvasCoach.width;
    const h = canvasCoach.height;

    const connections = [
        ['shoulderL', 'shoulderR'], ['shoulderL', 'hipL'], ['shoulderR', 'hipR'], ['hipL', 'hipR'],
        ['shoulderL', 'elbowL'], ['elbowL', 'wristL'], ['shoulderR', 'elbowR'], ['elbowR', 'wristR'],
        ['hipL', 'kneeL'], ['kneeL', 'ankleL'], ['hipR', 'kneeR'], ['kneeR', 'ankleR']
    ];

    connections.forEach(([p1, p2]) => {
        const pt1 = coachPose[p1];
        const pt2 = coachPose[p2];
        if (pt1 && pt2) {
            ctxCoach.beginPath();
            ctxCoach.moveTo(pt1.x * w, pt1.y * h);
            ctxCoach.lineTo(pt2.x * w, pt2.y * h);
            ctxCoach.stroke();
        }
    });

    ctxCoach.fillStyle = "#fff";
    ctxCoach.shadowBlur = 0;
    Object.values(coachPose).forEach(pt => {
        ctxCoach.beginPath();
        ctxCoach.arc(pt.x * w, pt.y * h, 6, 0, 2 * Math.PI);
        ctxCoach.fill();
    });

    ctxCoach.restore();
}

function getCoachKeyframes(stageIndex, beat, section) {
    const cx = 0.5;
    const cy = 0.45;
    const t = ((section - 1) * 8 + beat) / 16; 

    let pose = {
        shoulderL: { x: cx - 0.08, y: cy - 0.15 },
        shoulderR: { x: cx + 0.08, y: cy - 0.15 },
        hipL: { x: cx - 0.06, y: cy + 0.1 },
        hipR: { x: cx + 0.06, y: cy + 0.1 },
        
        elbowL: { x: cx - 0.12, y: cy - 0.05 },
        wristL: { x: cx - 0.15, y: cy + 0.05 },
        elbowR: { x: cx + 0.12, y: cy - 0.05 },
        wristR: { x: cx + 0.15, y: cy + 0.05 },
        
        kneeL: { x: cx - 0.06, y: cy + 0.25 },
        ankleL: { x: cx - 0.06, y: cy + 0.4 },
        kneeR: { x: cx + 0.06, y: cy + 0.25 },
        ankleR: { x: cx + 0.06, y: cy + 0.4 }
    };

    if (!isTVOn || currentAppState !== STATE_WORKOUT) {
        return pose;
    }

    const sinScale = Math.sin(t * Math.PI * 4);
    const sinPulse = Math.sin(t * Math.PI * 2);

    switch (stageIndex) {
        case 0: // 預備動作
            pose.elbowL = { x: cx - 0.15, y: cy + 0.05 };
            pose.wristL = { x: cx - 0.09, y: cy + 0.1 };
            pose.elbowR = { x: cx + 0.15, y: cy + 0.05 };
            pose.wristR = { x: cx + 0.09, y: cy + 0.1 };
            const readyY = Math.abs(sinScale) * 0.015;
            pose.hipL.y += readyY; pose.hipR.y += readyY;
            pose.kneeL.y += readyY; pose.kneeR.y += readyY;
            break;

        case 1: // 全深蹲
            pose = getSideViewBase(cx, cy);
            const squatDepth = Math.max(0, sinScale) * 0.18;
            pose.hip.y += squatDepth;
            pose.knee.y += squatDepth * 0.5;
            pose.elbow = { x: cx + 0.12, y: cy - 0.15 };
            pose.wrist = { x: cx + 0.22, y: cy - 0.15 };
            break;

        case 2: // 半深蹲
            pose = getSideViewBase(cx, cy);
            const halfDepth = Math.max(0, sinScale) * 0.09;
            pose.hip.y += halfDepth;
            pose.knee.y += halfDepth * 0.5;
            pose.elbow = { x: cx - 0.08, y: cy + 0.05 };
            pose.wrist = { x: cx - 0.02, y: cy + 0.08 };
            break;

        case 3: // 上肢伸展
            pose.elbowL = { x: cx - 0.08, y: cy - 0.25 };
            pose.wristL = { x: cx - 0.08, y: cy - 0.38 };
            pose.elbowR = { x: cx + 0.08, y: cy - 0.25 };
            pose.wristR = { x: cx + 0.08, y: cy - 0.38 };
            const stepY = Math.abs(sinScale) * 0.02;
            pose.hipL.y += stepY; pose.hipR.y += stepY;
            break;

        case 4: // 擴胸轉體
            const pBeat = (section - 1) * 8 + beat;
            if (pBeat >= 3 && pBeat <= 6) {
                pose.shoulderL.x = cx - 0.03;
                pose.shoulderR.x = cx + 0.03;
                pose.elbowL = { x: cx + 0.04, y: cy - 0.12 };
                pose.wristL = { x: cx + 0.05, y: cy - 0.15 };
                pose.elbowR = { x: cx + 0.18, y: cy - 0.15 };
                pose.wristR = { x: cx + 0.28, y: cy - 0.15 };
            } else if (pBeat >= 11 && pBeat <= 14) {
                pose.shoulderL.x = cx - 0.03;
                pose.shoulderR.x = cx + 0.03;
                pose.elbowR = { x: cx - 0.04, y: cy - 0.12 };
                pose.wristR = { x: cx - 0.05, y: cy - 0.15 };
                pose.elbowL = { x: cx - 0.18, y: cy - 0.15 };
                pose.wristL = { x: cx - 0.28, y: cy - 0.15 };
            } else if ((pBeat >= 1 && pBeat <= 2) || (pBeat >= 9 && pBeat <= 10)) {
                pose.elbowL = { x: cx - 0.12, y: cy - 0.15 };
                pose.wristL = { x: cx - 0.22, y: cy - 0.15 };
                pose.elbowR = { x: cx + 0.12, y: cy - 0.15 };
                pose.wristR = { x: cx + 0.22, y: cy - 0.15 };
            }
            break;

        case 5: // 體側左右彎曲
            const bendOffset = sinPulse * 0.06;
            pose.shoulderL.x += bendOffset; pose.shoulderR.x += bendOffset;
            pose.shoulderL.y += bendOffset * 0.5; pose.shoulderR.y -= bendOffset * 0.5;
            pose.elbowL = { x: cx - 0.06 + bendOffset, y: cy - 0.22 };
            pose.wristL = { x: cx - 0.04 + bendOffset, y: cy - 0.35 };
            pose.elbowR = { x: cx + 0.06 + bendOffset, y: cy - 0.22 };
            pose.wristR = { x: cx + 0.04 + bendOffset, y: cy - 0.35 };
            break;

        case 6: // 前後彎體
            pose = getSideViewBase(cx, cy);
            const isForward = (beat >= 2 && beat <= 5);
            if (isForward) {
                pose.shoulder.y += 0.12;
                pose.shoulder.x += 0.08;
                pose.elbow = { x: cx + 0.1, y: cy + 0.15 };
                pose.wrist = { x: cx + 0.12, y: cy + 0.35 };
            } else {
                pose.shoulder.x -= 0.06;
                pose.elbow = { x: cx - 0.08, y: cy + 0.05 };
                pose.wrist = { x: cx - 0.02, y: cy + 0.08 };
            }
            break;

        case 7: // 四肢運動
            const feetWide = 0.07 * (1 + Math.abs(sinScale));
            pose.ankleL.x = cx - feetWide;
            pose.ankleR.x = cx + feetWide;
            pose.kneeL.x = cx - feetWide * 0.8;
            pose.kneeR.x = cx + feetWide * 0.8;
            pose.elbowL = { x: cx - 0.18, y: cy - 0.12 };
            pose.wristL = { x: cx - 0.28, y: cy - 0.12 };
            pose.elbowR = { x: cx + 0.18, y: cy - 0.12 };
            pose.wristR = { x: cx + 0.28, y: cy - 0.12 };
            break;

        case 8: // 整理運動
            const waveY = (sinPulse + 1) * 0.15;
            pose.elbowL = { x: cx - 0.15, y: cy - 0.15 + waveY };
            pose.wristL = { x: cx - 0.26, y: cy - 0.15 + waveY };
            pose.elbowR = { x: cx + 0.15, y: cy - 0.15 + waveY };
            pose.wristR = { x: cx + 0.26, y: cy - 0.15 + waveY };
            break;
    }

    return pose;
}

function getSideViewBase(cx, cy) {
    return {
        shoulderL: { x: cx, y: cy - 0.15 },
        shoulderR: { x: cx, y: cy - 0.15 },
        shoulder: { x: cx, y: cy - 0.15 },
        
        hipL: { x: cx, y: cy + 0.1 },
        hipR: { x: cx, y: cy + 0.1 },
        hip: { x: cx, y: cy + 0.1 },
        
        elbowL: { x: cx - 0.03, y: cy - 0.05 },
        wristL: { x: cx - 0.05, y: cy + 0.05 },
        elbowR: { x: cx - 0.03, y: cy - 0.05 },
        wristR: { x: cx - 0.05, y: cy + 0.05 },
        elbow: { x: cx - 0.03, y: cy - 0.05 },
        wrist: { x: cx - 0.05, y: cy + 0.05 },
        
        kneeL: { x: cx - 0.02, y: cy + 0.25 },
        ankleL: { x: cx - 0.02, y: cy + 0.4 },
        kneeR: { x: cx - 0.02, y: cy + 0.25 },
        ankleR: { x: cx - 0.02, y: cy + 0.4 },
        knee: { x: cx - 0.02, y: cy + 0.25 },
        ankle: { x: cx - 0.02, y: cy + 0.4 }
    };
}
