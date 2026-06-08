// DOM Elements
const statTotalUsers = document.getElementById("stat-total-users");
const statTotalWorkouts = document.getElementById("stat-total-workouts");
const statTotalReps = document.getElementById("stat-total-reps");
const statAvgScore = document.getElementById("stat-avg-score");
const usersTableBody = document.getElementById("users-table-body");
const detailsSection = document.getElementById("details-section");

const readableModeNames = {
  twist: "腰部扭轉",
  squat: "深蹲動作",
  sidebend: "體側彎動作"
};

let selectedUserId = null;

// Initialize admin dashboard
async function initAdmin() {
  await loadSummary();
}

async function loadSummary() {
  try {
    const res = await fetch("/api/admin/summary");
    const summary = await res.json();
    
    // Update overview statistics card values
    statTotalUsers.textContent = summary.total_users;
    statTotalWorkouts.textContent = summary.total_workouts;
    statTotalReps.textContent = summary.total_reps;
    statAvgScore.textContent = `${summary.avg_score}分`;
    
    // Render users list
    renderUsersTable(summary.users);
    
    // If a user was previously selected, refresh their details
    if (selectedUserId) {
      const activeUser = summary.users.find(u => u.id == selectedUserId);
      if (activeUser) {
        await showUserDetails(activeUser);
      } else {
        resetDetailsSection();
      }
    }
  } catch (err) {
    console.error("載入後台總覽失敗:", err);
    usersTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="table-empty" style="color:var(--accent-red)">載入資料失敗，請確認後端伺服器已正常啟動。</td>
      </tr>
    `;
  }
}

function renderUsersTable(users) {
  if (users.length === 0) {
    usersTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="table-empty">目前尚無任何註冊使用者。</td>
      </tr>
    `;
    return;
  }
  
  usersTableBody.innerHTML = users.map(u => {
    const regDate = new Date(u.created_at).toLocaleDateString("zh-TW", {
      year: "numeric", month: "2-digit", day: "2-digit"
    });
    const age = u.age ? `${u.age} 歲` : "-";
    const height = u.height ? `${u.height} cm` : "-";
    const weight = u.weight ? `${u.weight} kg` : "-";
    
    const scoreClass = u.avg_score >= 85 ? 'glow-text-green' : (u.avg_score >= 60 ? 'glow-text-blue' : 'glow-text-red');
    const activeClass = u.id === selectedUserId ? 'class="active-row"' : '';
    
    return `
      <tr ${activeClass} id="user-row-${u.id}">
        <td><strong>${u.username}</strong></td>
        <td>${age}</td>
        <td>${height}</td>
        <td>${weight}</td>
        <td>${regDate}</td>
        <td>${u.total_workouts} 次</td>
        <td>${u.total_reps} 下</td>
        <td><span class="${scoreClass}">${u.avg_score} 分</span></td>
        <td>
          <button class="btn-table-action" onclick="handleViewDetails(${u.id})">調閱詳情</button>
        </td>
      </tr>
    `;
  }).join('');
}

function resetDetailsSection() {
  selectedUserId = null;
  detailsSection.innerHTML = `
    <div class="details-placeholder">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48" fill="currentColor">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 10H7v-2h10v2zm0-4H7V7h10v2zm-4 8H7v-2h6v2z"/>
      </svg>
      <p>請點擊左側列表的「調閱詳情」按鈕以檢視該名使用者的歷史運動紀錄。</p>
    </div>
  `;
}

// Global helper for row click
window.handleViewDetails = async function(userId) {
  selectedUserId = userId;
  
  // Highlight active row
  document.querySelectorAll("#users-table-body tr").forEach(tr => tr.classList.remove("active-row"));
  const activeRow = document.getElementById(`user-row-${userId}`);
  if (activeRow) activeRow.classList.add("active-row");
  
  try {
    const res = await fetch("/api/admin/summary");
    const summary = await res.json();
    const user = summary.users.find(u => u.id == userId);
    if (user) {
      await showUserDetails(user);
    }
  } catch (err) {
    console.error("獲取使用者詳情失敗:", err);
  }
};

async function showUserDetails(user) {
  try {
    const resLogs = await fetch(`/api/workouts?user_id=${user.id}`);
    const logs = await resLogs.json();
    
    const totalMin = Math.floor(user.total_duration / 60);
    const totalSec = user.total_duration % 60;
    const durationStr = totalMin > 0 ? `${totalMin}分${totalSec}秒` : `${totalSec}秒`;
    
    let logsHtml = "";
    if (logs.length === 0) {
      logsHtml = `
        <tr>
          <td colspan="5" class="table-empty">尚無任何運動訓練日誌紀錄。</td>
        </tr>
      `;
    } else {
      logsHtml = logs.map(log => {
        const dateStr = new Date(log.created_at).toLocaleString("zh-TW", {
          month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false
        });
        const modeText = readableModeNames[log.mode] || log.mode;
        const scoreClass = log.avg_score >= 85 ? 'glow-text-green' : (log.avg_score >= 60 ? 'glow-text-blue' : 'glow-text-red');
        return `
          <tr>
            <td>${dateStr}</td>
            <td><strong>${modeText}</strong></td>
            <td>${log.reps} 次</td>
            <td><span class="${scoreClass}">${log.avg_score} 分</span></td>
            <td>
              <button class="btn danger-btn" onclick="handleDeleteLog(${log.id})">刪除</button>
            </td>
          </tr>
        `;
      }).join('');
    }
    
    detailsSection.innerHTML = `
      <h3 style="margin-bottom:15px; border-left:3px solid var(--accent-green); padding-left:10px;">👤 ${user.username} 的個人檔案與紀錄</h3>
      
      <div class="user-info-card">
        <div class="info-item">
          <span class="info-label">年齡 / 身高 / 體重</span>
          <span class="info-val">${user.age || "-"} 歲 | ${user.height || "-"} cm | ${user.weight || "-"} kg</span>
        </div>
        <div class="info-item">
          <span class="info-label">累計運動時間</span>
          <span class="info-val">${durationStr}</span>
        </div>
      </div>
      
      <h3 style="margin-bottom:12px; border-left:3px solid var(--accent-yellow); padding-left:10px; font-size:1rem;">📋 運動日誌明細 (Scrollable)</h3>
      <div class="table-container table-scroll">
        <table>
          <thead>
            <tr>
              <th>時間</th>
              <th>訓練項目</th>
              <th>動作次數</th>
              <th>平均得分</th>
              <th>管理</th>
            </tr>
          </thead>
          <tbody>
            ${logsHtml}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    console.error("載入詳細日誌出錯:", err);
  }
}

// Global helper for delete
window.handleDeleteLog = async function(logId) {
  if (!confirm("確定要永久刪除這筆運動日誌嗎？此操作不可逆！")) return;
  
  try {
    const res = await fetch(`/api/workouts/${logId}`, { method: "DELETE" });
    const data = await res.json();
    if (data.success) {
      // Refresh summary and user details panel
      await loadSummary();
    } else {
      alert("刪除失敗");
    }
  } catch (err) {
    console.error("刪除日誌發生錯誤:", err);
    alert("刪除日誌發生錯誤，請稍後再試。");
  }
};

// Start application
window.addEventListener("DOMContentLoaded", initAdmin);
