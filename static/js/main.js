let isGridLayout = false; let currentPath = ""; let currentUser = ""; let userRole = ""; let pendingVideoSrc = ""; let pendingVideoLink = "";
let userFavs = []; let allItems = []; let currentPage = 1; const pageSize = 30;

function toggleTheme() {
    const b = document.body;
    if (b.classList.contains('theme-eye')) {
        b.classList.remove('theme-eye'); b.classList.add('theme-dark'); localStorage.setItem('la_theme', 'dark');
    } else if (b.classList.contains('theme-dark')) {
        b.classList.remove('theme-dark'); localStorage.removeItem('la_theme');
    } else {
        b.classList.add('theme-eye'); localStorage.setItem('la_theme', 'eye');
    }
}
const savedTheme = localStorage.getItem('la_theme');
if (savedTheme) { document.body.className = 'theme-' + savedTheme; } else { document.body.className = ''; }

function escapeHtml(text) { if (!text) return ""; const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}; return text.toString().replace(/[&<>"']/g, m => map[m]); }

function getGravatar(email, name) {
    const str = (email || name || "default").trim().toLowerCase();
    if (typeof md5 === 'function') {
        const hash = md5(str);
        return `https://cravatar.cn/avatar/${hash}?d=identicon`;
    }
    return `https://cravatar.cn/avatar/default?d=identicon`;
}

function toggleLayout() {
    isGridLayout = !isGridLayout;
    document.getElementById('layoutBtn').innerText = isGridLayout ? "切换列表" : "切换网格";
    renderFilesByPage();
}

function closeVideo() {
    const v = document.getElementById('mainVideo');
    if (v) v.pause();
    document.getElementById('videoWrap').innerHTML = "";
    bootstrap.Modal.getInstance(document.getElementById('playModal')).hide();
}

function setSpeed(s) {
    const v = document.getElementById('mainVideo');
    if (v) {
        v.playbackRate = s;
        document.querySelectorAll('#playModal .btn-xs').forEach(b => b.classList.remove('active'));
        if (event && event.target) event.target.classList.add('active');
    }
}

function previewImage(url) { window.open(url, '_blank'); }

function goPath(p) {
    currentPath = p;
    currentPage = 1;
    loadData();
}

function showAvatarModal() {
    new bootstrap.Modal(document.getElementById('avatarModal')).show();
}

function logout() { window.location.href = '/logout'; }

function handleFileClick(link, isVid, isPdf, name) {
    if (isVid) {
        pendingVideoSrc = '/download/' + link;
        pendingVideoLink = link;
        new bootstrap.Modal(document.getElementById('playModal')).show();
    } else if (isPdf) {
        document.getElementById('pdfTitle').innerText = name;
        document.getElementById('pdfFrame').src = '/download/' + link;
        new bootstrap.Modal(document.getElementById('pdfModal')).show();
    } else {
        window.open('/download/' + link, '_blank');
    }
}

function executeSearch() {
    const q = document.getElementById('fileSearch').value.trim();
    loadData(true, q);
}

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);

// --- 【修改点 1: 读取记忆】 ---
    // 逻辑：URL优先，URL没有则看本地存储
    const urlPath = params.get('p');
    const savedPath = localStorage.getItem('last_path');
    currentPath = (urlPath !== null) ? urlPath : (savedPath || "");
    // ----------------------------

    loadData();
    const playModalEl = document.getElementById('playModal');
    if (playModalEl) {
        playModalEl.addEventListener('shown.bs.modal', function () {
            if (pendingVideoSrc) {
                const cacheBuster = `_v=${Date.now()}`;
                const finalSrc = pendingVideoSrc.includes('?') ? `${pendingVideoSrc}&${cacheBuster}` : `${pendingVideoSrc}?${cacheBuster}`;
                document.getElementById('videoWrap').innerHTML = `
                    <video id="mainVideo" controls autoplay controlsList="nodownload" oncontextmenu="return false;" style="width:100%;">
                        <source src="${finalSrc}" type="video/mp4">
                    </video>`;
                const v = document.getElementById('mainVideo');
                const lastPos = localStorage.getItem('pos_' + pendingVideoLink);
                if (lastPos) {
                    v.currentTime = parseFloat(lastPos);
                    const tip = document.getElementById('resumeTip');
                    if(tip) { tip.style.display = 'block'; setTimeout(() => tip.style.display = 'none', 3000); }
                }
                v.ontimeupdate = () => { if(v.currentTime > 5) localStorage.setItem('pos_' + pendingVideoLink, v.currentTime); };
                pendingVideoSrc = "";
            }
        });
    }

    // --- 【新增：PDF 关闭清理逻辑】 ---
    const pdfModalEl = document.getElementById('pdfModal');
    if (pdfModalEl) {
        pdfModalEl.addEventListener('hidden.bs.modal', function () {
            const frame = document.getElementById('pdfFrame');
            if (frame) frame.src = ""; // 彻底切断 PDF 后台加载
        });
    }
    // -------------------------------

    window.onpopstate = () => { const params = new URLSearchParams(window.location.search); currentPath = params.get('p') || ""; loadData(false); };
});

async function loadData(shouldPushState = true, query = "") {
    try {
        const favRes = await fetch('/api/get_favs');
        if (favRes.ok) userFavs = await favRes.json();
        const response = await fetch(`/api/data?p=${encodeURIComponent(currentPath)}&q=${encodeURIComponent(query)}&_t=${Date.now()}`);
        const data = await response.json();

        // --- 【修改点 2: 存储记忆】 ---
        // 只有在非搜索状态下才记忆路径
        if (!query) {
            localStorage.setItem('last_path', currentPath);
        }
        // ----------------------------

        currentUser = data.user.name; userRole = data.user.role;
        document.getElementById('uName').textContent = currentUser;
        document.getElementById('uAvatar').src = getGravatar(data.user.email, data.user.name);
        allItems = data.items || [];
        if(query) currentPage = 1;
        renderBreadcrumbs();
        renderFilesByPage();
        renderChat(data.chat);
        updateHistoryMenu();
        if (shouldPushState) {
            const url = new URL(window.location);
            url.searchParams.set('p', currentPath);
            window.history.pushState({path: currentPath}, '', url);
        }
    } catch (e) { console.error(e); }
}
function renderFilesByPage() {
    const container = document.getElementById('fileContainer');
    const totalPages = Math.ceil(allItems.length / pageSize) || 1;
    const start = (currentPage - 1) * pageSize;
    const pageItems = allItems.slice(start, start + pageSize);
    document.getElementById('pageLabel').innerText = `第 ${currentPage} / ${totalPages} 页 (共 ${allItems.length} 项)`;
    document.getElementById('prevBtn').disabled = (currentPage === 1);
    document.getElementById('nextBtn').disabled = (currentPage === totalPages);
    const pager = document.getElementById('pager');
    if(pager) pager.style.display = allItems.length <= pageSize ? 'none' : 'flex';
    container.style.opacity = '0';
    setTimeout(() => {
        container.className = isGridLayout ? "file-grid" : "file-list";
        if (!pageItems.length) { container.innerHTML = '<div class="p-5 text-center text-muted w-100">无结果</div>'; container.style.opacity = '1'; return; }
        container.innerHTML = pageItems.map((item, index) => {
            const nameLower = item.name.toLowerCase();
            const isImg = /\.(jpg|jpeg|png|gif|webp|bmp)$/.test(nameLower);
            const isVid = /\.(mp4|mkv|asf|flv|rm|avi|wmv|mov)$/.test(nameLower);
            const isPdf = nameLower.endsWith('.pdf');
            const escapedName = escapeHtml(item.name);
            const escapedLink = escapeHtml(item.rel_link);
            const isFav = userFavs.some(f => f.rel_link === item.rel_link);
            let icon = item.is_dir ? "📁" : (isVid ? "🎬" : (isPdf ? "📕" : "📄"));
            let thumb = (item.is_img || isImg) ? `<img src="/download/${escapedLink}" loading="lazy">` : icon;
            let clickAction = "";
            if (item.is_dir) { clickAction = `onclick="goPath('${escapedLink}')"`; }
            else if (isImg) { clickAction = `onclick="previewImage('/download/${escapedLink}')"`; }
            else { clickAction = `onclick="handleFileClick('${escapedLink}', ${isVid}, ${isPdf}, '${escapedName}')"`; }
            const favBtn = item.is_dir ? '' : `<button class="btn-star ${isFav?'active':''}" onclick="toggleFav(event, '${escapedLink}', '${escapedName}', this)">★</button>`;
            return `<div class="file-card" style="animation-delay: ${(index*0.02).toFixed(2)}s" ${clickAction}>
                ${favBtn}<div class="thumb-box">${thumb}</div><div class="file-name">${escapedName}</div>
            </div>`;
        }).join('');
        container.style.opacity = '1';
    }, 50);
}

function changePage(offset) { currentPage += offset; renderFilesByPage(); window.scrollTo({top: 0, behavior: 'smooth'}); }
function jumpToPage() {
    const input = document.getElementById('jumpInput');
    const val = parseInt(input.value);
    const totalPages = Math.ceil(allItems.length / pageSize) || 1;
    if (val >= 1 && val <= totalPages) { currentPage = val; renderFilesByPage(); window.scrollTo({top: 0, behavior: 'smooth'}); input.value = ""; } else { alert("页码超出范围"); }
}

function renderBreadcrumbs() {
    const nav = document.getElementById('pathNav');
    if(!nav) return;
    let html = '<li class="breadcrumb-item"><a href="javascript:void(0)" onclick="goPath(\'\')">根目录</a></li>';
    if (currentPath) {
        let parts = currentBuildParts = currentPath.split('/');
        let currentBuild = "";
        parts.forEach((p, i) => {
            if (!p) return;
            currentBuild += (currentBuild ? "/" : "") + p;
            if (i === parts.length - 1) {
                html += `<li class="breadcrumb-item active">${escapeHtml(p)}</li>`;
            } else {
                html += `<li class="breadcrumb-item"><a href="javascript:void(0)" onclick="goPath('${escapeHtml(currentBuild)}')">${escapeHtml(p)}</a></li>`;
            }
        });
    }
    nav.innerHTML = html;
    nav.scrollLeft = nav.scrollWidth;
}

async function toggleFav(e, link, name, btn) {
    e.stopPropagation();
    const isRemoving = btn.classList.contains('active');
    const url = isRemoving ? '/api/del_fav' : '/api/add_fav';
    try {
        const res = await fetch(url, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({rel_link: link, name: name}) });
        if (res.ok) {
            btn.classList.toggle('active');
            if (isRemoving) { userFavs = userFavs.filter(f => f.rel_link !== link); }
            else { userFavs.push({rel_link: link, name: name}); }
        }
    } catch (e) { console.error(e); }
}

async function syncFavs() {
    const res = await fetch('/api/get_favs');
    if (res.ok) {
        userFavs = await res.json();
        const container = document.getElementById('favContent');
        if(!container) return;
        if (!userFavs.length) { container.innerHTML = '<div class="p-5 text-center text-muted">暂无收藏</div>'; return; }
        container.innerHTML = userFavs.map(f => {
            const fLow = f.name.toLowerCase();
            const isVid = /\.(mp4|mkv|asf|flv|rm|avi|wmv|mov)$/.test(fLow);
            const isPdf = fLow.endsWith('.pdf');
            const isImg = /\.(jpg|jpeg|png|gif|webp|bmp)$/.test(fLow);
            let icon = isVid ? "🎬" : (isPdf ? "📕" : (isImg ? "🖼️" : "📄"));
            let thumb = isImg ? `<img src="/download/${escapeHtml(f.rel_link)}">` : icon;
            return `<div class="fav-item" onclick="handleFileClick('${escapeHtml(f.rel_link)}', ${isVid}, ${isPdf}, '${escapeHtml(f.name)}')">
                <div class="fav-thumb-container">${thumb}</div>
                <div class="fav-item-info"><div class="fav-item-name">${escapeHtml(f.name)}</div></div>
                <button class="btn-fav-del" onclick="event.stopPropagation(); removeFav('${escapeHtml(f.rel_link)}')">×</button>
            </div>`;
        }).join('');
    }
}

async function removeFav(link) {
    const res = await fetch('/api/del_fav', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({rel_link: link}) });
    if (res.ok) { syncFavs(); loadData(false); }
}

function updateHistoryMenu() {
    let history = JSON.parse(localStorage.getItem('la_history') || '[]');
    if (currentPath && !history.includes(currentPath)) {
        history.unshift(currentPath);
        if (history.length > 10) history.pop();
        localStorage.setItem('la_history', JSON.stringify(history));
    }
    const list = document.getElementById('historyList');
    if(!list) return;
    if (!history.length) { list.innerHTML = '<li><span class="dropdown-item-text text-muted">无历史记录</span></li>'; return; }
    list.innerHTML = history.map(h => `<li><a class="dropdown-item text-truncate" style="max-width:280px" href="javascript:void(0)" onclick="goPath('${escapeHtml(h)}')">${escapeHtml(h || '根目录')}</a></li>`).join('') +
                     `<li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-danger" href="javascript:void(0)" onclick="localStorage.removeItem('la_history');updateHistoryMenu();">清除历史</a></li>`;
}

async function sendMsg() {
    const input = document.getElementById('msgInput');
    const btn = document.getElementById('sendBtn');
    if(!input) return;
    const content = input.value.trim();
    if (!content) return;
    btn.disabled = true;
    try {
        const res = await fetch('/api/send_msg', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({msg: content}) });
        if (res.ok) { input.value = ''; await loadData(false); }
        else { const r = await res.json(); alert(r.msg || "发送失败"); }
    } catch(e) { alert("网络连接失败"); } finally { btn.disabled = false; }
}

async function deleteMsg(id) {
    if (!confirm("确定删除此留言？")) return;
    try {
        const res = await fetch('/api/del_msg', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: id}) });
        if (res.ok) await loadData(false);
    } catch(e) { alert("操作失败"); }
}

function renderChat(chats) {
    const box = document.getElementById('chatBox');
    if (!chats || !box) return;
    box.innerHTML = chats.map(c => {
        const isSelf = (c.user === currentUser);
        const isAdmin = (c.role === 'admin' || c.role === '管理员' || c.role === '管理員');
        const avatarUrl = getGravatar(c.email, c.user);
        return `
        <div class="chat-item">
            <div class="chat-left">
                <img src="${avatarUrl}" class="chat-avatar">
                <div class="chat-body">
                    <div class="chat-user-row">
                        <span class="chat-user-name" style="${isAdmin ? 'color: #ff4d4f; font-weight: bold;' : ''}">${escapeHtml(c.user)}</span>
                        ${c.title ? `<span class="title-badge ${isAdmin ? 'bg-danger' : 'bg-primary'}">${escapeHtml(c.title)}</span>` : ''}
                    </div>
                    <div class="chat-content">${escapeHtml(c.msg || c.content)}</div>
                </div>
            </div>
            <div class="chat-right">
                <span class="chat-time">${c.time}</span>
                ${(isSelf || userRole === 'admin' || userRole === '管理员' || userRole === '管理員') ? `<a href="javascript:void(0)" class="text-danger small ms-2" onclick="deleteMsg(${c.id})">删除</a>` : ''}
            </div>
        </div>`;
    }).join('');
    if (currentPage === 1) box.scrollTop = box.scrollHeight;
}