let isGridLayout = false; let currentPath = ""; let currentUser = ""; let userRole = ""; let pendingVideoSrc = ""; let pendingVideoLink = "";
let userFavs = []; let allItems = []; let currentPage = 1; const pageSize = 30;
let favDrawerStatePushed = false; let closingFavFromPop = false;
let historyDrawerStatePushed = false; let closingHistoryFromPop = false;
let videoModalStatePushed = false; let closingVideoFromPop = false;
let groupPickerLink = "";
let searchDebounceTimer = null;
let latestLoadToken = 0;
let latestRenderToken = 0;
let lastChatSignature = "";
let replyTarget = null;
let currentDisplayName = "";
let currentAvatar = "";
let avatarCropImage = null;

function renderAvatarCrop() {
    const canvas = document.getElementById('avatarCropCanvas');
    if (!canvas || !avatarCropImage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const zoom = (parseInt(document.getElementById('avatarZoom')?.value || '100', 10) || 100) / 100;
    const offsetX = parseInt(document.getElementById('avatarOffsetX')?.value || '0', 10) || 0;
    const offsetY = parseInt(document.getElementById('avatarOffsetY')?.value || '0', 10) || 0;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, w, h);

    const baseScale = Math.max(w / avatarCropImage.width, h / avatarCropImage.height);
    const scale = baseScale * zoom;
    const dw = avatarCropImage.width * scale;
    const dh = avatarCropImage.height * scale;
    const dx = (w - dw) / 2 + (offsetX / 100) * (w * 0.35);
    const dy = (h - dh) / 2 + (offsetY / 100) * (h * 0.35);
    ctx.drawImage(avatarCropImage, dx, dy, dw, dh);
}

function resetAvatarCropUI() {
    const cropWrap = document.getElementById('avatarCropWrap');
    const zoom = document.getElementById('avatarZoom');
    const ox = document.getElementById('avatarOffsetX');
    const oy = document.getElementById('avatarOffsetY');
    if (cropWrap) cropWrap.style.display = 'none';
    if (zoom) zoom.value = '100';
    if (ox) ox.value = '0';
    if (oy) oy.value = '0';
    avatarCropImage = null;
}

function bindAvatarCropEvents() {
    const fileInput = document.getElementById('profileAvatarFile');
    const zoom = document.getElementById('avatarZoom');
    const ox = document.getElementById('avatarOffsetX');
    const oy = document.getElementById('avatarOffsetY');
    const cropWrap = document.getElementById('avatarCropWrap');

    [zoom, ox, oy].forEach(el => {
        if (!el) return;
        el.addEventListener('input', renderAvatarCrop);
    });

    if (!fileInput) return;
    fileInput.addEventListener('change', () => {
        const f = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
        if (!f) {
            resetAvatarCropUI();
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                avatarCropImage = img;
                if (cropWrap) cropWrap.style.display = 'block';
                if (zoom) zoom.value = '100';
                if (ox) ox.value = '0';
                if (oy) oy.value = '0';
                renderAvatarCrop();
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(f);
    });
}


function getFavGroupStorageKey() {
    return `la_fav_groups_${currentUser || 'guest'}`;
}

function getCustomFavGroups() {
    try {
        const raw = localStorage.getItem(getFavGroupStorageKey());
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.filter(Boolean) : [];
    } catch (e) {
        return [];
    }
}

function saveCustomFavGroups(groups) {
    const cleaned = [...new Set(groups.map(g => (g || '').trim()).filter(Boolean))];
    localStorage.setItem(getFavGroupStorageKey(), JSON.stringify(cleaned));
}

function getAllFavGroups() {
    const existing = userFavs.map(f => (f.group || '默认').trim());
    const custom = getCustomFavGroups();
    const merged = ['默认', ...custom, ...existing];
    return [...new Set(merged.filter(Boolean))].sort();
}

function refreshFavGroupFilterOptions() {
    const filter = document.getElementById('favGroupFilter');
    if (!filter) return;
    const currentVal = filter.value;
    const groups = getAllFavGroups();
    filter.innerHTML = '';

    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = '全部分组';
    filter.appendChild(allOpt);

    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        filter.appendChild(opt);
    });
    filter.value = groups.includes(currentVal) ? currentVal : '';
}

function openGroupPicker(link) {
    groupPickerLink = link;
    const modalEl = document.getElementById('groupPickerModal');
    const select = document.getElementById('groupPickerSelect');
    const input = document.getElementById('groupPickerNewName');
    if (!modalEl || !select || !input) return;

    const groups = getAllFavGroups();
    const favItem = userFavs.find(f => f.rel_link === link);
    const currentGroup = (favItem && favItem.group) ? favItem.group : '默认';

    select.innerHTML = '';
    groups.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g;
        opt.textContent = g;
        select.appendChild(opt);
    });
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '+ 新建分组';
    select.appendChild(newOpt);

    select.value = groups.includes(currentGroup) ? currentGroup : '默认';
    input.value = '';
    input.style.display = 'none';

    select.onchange = function () {
        input.style.display = (select.value === '__new__') ? 'block' : 'none';
        if (select.value === '__new__') input.focus();
    };

    new bootstrap.Modal(modalEl).show();
}

async function saveGroupAssignment() {
    if (!groupPickerLink) return;
    const select = document.getElementById('groupPickerSelect');
    const input = document.getElementById('groupPickerNewName');
    if (!select || !input) return;

    let group = select.value;
    if (group === '__new__') {
        group = input.value.trim();
        if (!group) {
            alert('请输入新分组名称');
            return;
        }
        saveCustomFavGroups([...getCustomFavGroups(), group]);
    }

    const res = await apiFetch('/api/update_fav', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({rel_link: groupPickerLink, group: group})
    });

    if (res.ok) {
        await syncFavs();
        const modalEl = document.getElementById('groupPickerModal');
        const instance = modalEl ? bootstrap.Modal.getInstance(modalEl) : null;
        if (instance) instance.hide();
    }
}

function toggleTheme() {
    document.body.classList.add('theme-switching');
    const b = document.body;
    if (b.classList.contains('theme-eye')) {
        b.classList.remove('theme-eye'); b.classList.add('theme-dark'); localStorage.setItem('la_theme', 'dark');
    } else if (b.classList.contains('theme-dark')) {
        b.classList.remove('theme-dark'); localStorage.removeItem('la_theme');
    } else {
        b.classList.add('theme-eye'); localStorage.setItem('la_theme', 'eye');
    }
    setTimeout(() => document.body.classList.remove('theme-switching'), 220);
}
const savedTheme = localStorage.getItem('la_theme');
if (savedTheme) { document.body.className = 'theme-' + savedTheme; } else { document.body.className = ''; }

function escapeHtml(text) { if (!text) return ""; const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}; return text.toString().replace(/[&<>"']/g, m => map[m]); }

function getCsrfToken() {
    const el = document.querySelector('meta[name="csrf-token"]');
    return el ? el.getAttribute('content') : '';
}

function apiFetch(url, options = {}) {
    const finalOptions = {...options};
    const method = (finalOptions.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        finalOptions.headers = {...(finalOptions.headers || {}), 'X-CSRF-Token': getCsrfToken()};
    }
    return fetch(url, finalOptions);
}

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

function setSpeed(s, evt) {
    const v = document.getElementById('mainVideo');
    if (v) {
        v.playbackRate = s;
        document.querySelectorAll('#playModal .btn-xs').forEach(b => b.classList.remove('active'));
        if (evt && evt.target) evt.target.classList.add('active');
    }
}

function previewImage(url) { window.open(url, '_blank'); }

function goPath(p) {
    currentPath = p;
    currentPage = 1;
    loadData();
}

function showAvatarModal() {
    const nameInput = document.getElementById('profileDisplayName');
    const preview = document.getElementById('profilePreview');
    const fileInput = document.getElementById('profileAvatarFile');
    const tip = document.getElementById('profileTip');
    if (nameInput) nameInput.value = currentDisplayName || currentUser || '';
    if (preview) preview.src = currentAvatar || '';
    if (fileInput) fileInput.value = '';
    if (tip) tip.textContent = '';
    resetAvatarCropUI();
    new bootstrap.Modal(document.getElementById('avatarModal')).show();
}

async function saveProfile() {
    const nameInput = document.getElementById('profileDisplayName');
    const fileInput = document.getElementById('profileAvatarFile');
    const tip = document.getElementById('profileTip');
    const displayName = (nameInput ? nameInput.value : '').trim();
    const file = fileInput && fileInput.files ? fileInput.files[0] : null;

    if (displayName.length > 20) {
        if (tip) tip.textContent = '显示名称最多20字';
        return;
    }
    if (file) {
        const allow = ['image/png', 'image/jpeg', 'image/webp'];
        if (!allow.includes(file.type)) {
            if (tip) tip.textContent = '仅支持 PNG/JPG/WEBP 图片';
            return;
        }
        if (file.size > 512 * 1024) {
            if (tip) tip.textContent = '头像图片不能超过 512KB';
            return;
        }
    }

    const fd = new FormData();
    fd.append('display_name', displayName);
    if (file) {
        if (!avatarCropImage) {
            fd.append('avatar', file);
        } else {
            const canvas = document.getElementById('avatarCropCanvas');
            if (canvas && canvas.toBlob) {
                const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 0.95));
                if (blob) fd.append('avatar', blob, 'avatar.png');
            }
        }
    }

    const res = await apiFetch('/api/profile/update', {method: 'POST', body: fd});
    const data = await res.json();
    if (!res.ok || data.status !== 'ok') {
        if (tip) tip.textContent = (data && data.msg) ? data.msg : '保存失败';
        return;
    }
    const user = data.user || {};
    currentDisplayName = user.display_name || user.name || currentUser;
    currentAvatar = user.avatar || currentAvatar;
    document.getElementById('uName').textContent = currentDisplayName;
    document.getElementById('uAvatar').src = currentAvatar;
    const preview = document.getElementById('profilePreview');
    if (preview) preview.src = currentAvatar;
    if (tip) tip.textContent = '保存成功';
    await loadChatOnly(true);
}

async function resetProfileAvatar() {
    const tip = document.getElementById('profileTip');
    const res = await apiFetch('/api/profile/reset_avatar', {method: 'POST'});
    const data = await res.json();
    if (!res.ok || data.status !== 'ok') {
        if (tip) tip.textContent = (data && data.msg) ? data.msg : '恢复失败';
        return;
    }
    const user = data.user || {};
    currentAvatar = user.avatar || currentAvatar;
    document.getElementById('uAvatar').src = currentAvatar;
    const preview = document.getElementById('profilePreview');
    if (preview) preview.src = currentAvatar;
    if (tip) tip.textContent = '已恢复默认邮箱头像';
    const fileInput = document.getElementById('profileAvatarFile');
    if (fileInput) fileInput.value = '';
    resetAvatarCropUI();
    await loadChatOnly(true);
}

function logout() { window.location.href = '/logout'; }

function handleFileClick(link, isVid, isPdf, isTxt, name) {
    const safeLink = encodeURI(link);
    if (isVid) {
        pendingVideoSrc = '/download/' + safeLink;
        pendingVideoLink = link;
        new bootstrap.Modal(document.getElementById('playModal')).show();
    } else if (isPdf) {
        window.open('/preview/' + safeLink + '?from=' + encodeURIComponent(currentPath), '_blank');
    } else if (isTxt) {
        window.open('/preview/' + safeLink + '?from=' + encodeURIComponent(currentPath), '_blank');
    } else {
        window.open('/download/' + safeLink, '_blank');
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
    bindAvatarCropEvents();
    const searchInput = document.getElementById('fileSearch');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => {
                executeSearch();
            }, 280);
        });
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
                executeSearch();
            }
        });
    }

    window.addEventListener('scroll', () => {
        if (window.innerWidth > 576) return;
        const dropBtn = document.querySelector('.history-dropdown .dropdown-toggle');
        if (!dropBtn) return;
        const inst = bootstrap.Dropdown.getInstance(dropBtn);
        if (inst) inst.hide();
    }, {passive: true});

    const playModalEl = document.getElementById('playModal');
    if (playModalEl) {
        playModalEl.addEventListener('shown.bs.modal', function () {
            if (!videoModalStatePushed) {
                const url = new URL(window.location.href);
                url.hash = 'video';
                window.history.pushState({videoModal: true}, '', url);
                videoModalStatePushed = true;
            }
        });

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

        playModalEl.addEventListener('hidden.bs.modal', function () {
            const v = document.getElementById('mainVideo');
            if (v) v.pause();
            const wrap = document.getElementById('videoWrap');
            if (wrap) wrap.innerHTML = '';
            if (videoModalStatePushed && !closingVideoFromPop) {
                window.history.back();
            }
            closingVideoFromPop = false;
            videoModalStatePushed = false;
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

    const favDrawerEl = document.getElementById('favDrawer');
    if (favDrawerEl) {
        favDrawerEl.addEventListener('shown.bs.offcanvas', () => {
            if (!favDrawerStatePushed) {
                const url = new URL(window.location.href);
                url.hash = 'fav';
                window.history.pushState({favDrawer: true}, '', url);
                favDrawerStatePushed = true;
            }
        });

        favDrawerEl.addEventListener('hidden.bs.offcanvas', () => {
            if (favDrawerStatePushed && !closingFavFromPop) {
                window.history.back();
            }
            closingFavFromPop = false;
            favDrawerStatePushed = false;
        });
    }

    const historyDrawerEl = document.getElementById('historyDrawer');
    if (historyDrawerEl) {
        historyDrawerEl.addEventListener('shown.bs.offcanvas', () => {
            if (!historyDrawerStatePushed) {
                const url = new URL(window.location.href);
                url.hash = 'history';
                window.history.pushState({historyDrawer: true}, '', url);
                historyDrawerStatePushed = true;
            }
        });

        historyDrawerEl.addEventListener('hidden.bs.offcanvas', () => {
            if (historyDrawerStatePushed && !closingHistoryFromPop) {
                window.history.back();
            }
            closingHistoryFromPop = false;
            historyDrawerStatePushed = false;
        });
    }

    window.onpopstate = () => {
        const favDrawerEl = document.getElementById('favDrawer');
        const historyDrawerEl = document.getElementById('historyDrawer');
        const playModal = document.getElementById('playModal');
        const hasOverlayOpen =
            ((favDrawerEl && favDrawerEl.classList.contains('show')) ||
             (historyDrawerEl && historyDrawerEl.classList.contains('show')) ||
             (playModal && playModal.classList.contains('show')));
        if (hasOverlayOpen) return;
        const params = new URLSearchParams(window.location.search);
        currentPath = params.get('p') || "";
        loadData(false);
    };
});

window.addEventListener('popstate', () => {
    const favDrawerEl = document.getElementById('favDrawer');
    const favInstance = favDrawerEl ? bootstrap.Offcanvas.getInstance(favDrawerEl) : null;
    if (favInstance && favDrawerEl.classList.contains('show')) {
        closingFavFromPop = true;
        favInstance.hide();
    }

    const historyDrawerEl = document.getElementById('historyDrawer');
    const historyInstance = historyDrawerEl ? bootstrap.Offcanvas.getInstance(historyDrawerEl) : null;
    if (historyInstance && historyDrawerEl.classList.contains('show')) {
        closingHistoryFromPop = true;
        historyInstance.hide();
    }

    const playModalEl = document.getElementById('playModal');
    const playModalInst = playModalEl ? bootstrap.Modal.getInstance(playModalEl) : null;
    if (playModalInst && playModalEl.classList.contains('show')) {
        closingVideoFromPop = true;
        playModalInst.hide();
    }
});

async function loadData(shouldPushState = true, query = "") {
    const loadToken = ++latestLoadToken;
    try {
        const ts = Date.now();
        const filesUrl = `/api/files?p=${encodeURIComponent(currentPath)}&q=${encodeURIComponent(query)}&_t=${ts}`;
        const chatUrl = `/api/chat?_t=${ts}`;
        const favUrl = `/api/get_favs?_t=${ts}`;
        const [filesResp, chatResp, favResp] = await Promise.all([
            fetch(filesUrl),
            fetch(chatUrl),
            fetch(favUrl)
        ]);

        if (!filesResp.ok) throw new Error('files api failed');
        const filesData = await filesResp.json();
        const chatData = chatResp.ok ? await chatResp.json() : {chat: []};
        userFavs = favResp.ok ? await favResp.json() : [];
        if (loadToken !== latestLoadToken) return;

        // --- 【修改点 2: 存储记忆】 ---
        // 只有在非搜索状态下才记忆路径
        if (!query) {
            localStorage.setItem('last_path', currentPath);
        }
        // ----------------------------

        currentUser = filesData.user.name; userRole = filesData.user.role;
        currentDisplayName = filesData.user.display_name || filesData.user.name;
        currentAvatar = filesData.user.avatar || getGravatar(filesData.user.email, filesData.user.name);
        document.getElementById('uName').textContent = currentDisplayName;
        document.getElementById('uAvatar').src = currentAvatar;
        allItems = filesData.items || [];
        if(query) currentPage = 1;
        renderBreadcrumbs();
        renderFilesByPage();
        renderChat(chatData.chat || []);
        updateHistoryMenu();
        if (shouldPushState) {
            const url = new URL(window.location);
            url.searchParams.set('p', currentPath);
            window.history.pushState({path: currentPath}, '', url);
        }
    } catch (e) { console.error(e); }
}

function buildFileCardHtml(item, favSet) {
    const nameLower = item.name.toLowerCase();
    const isImg = /\.(jpg|jpeg|png|gif|webp|bmp)$/.test(nameLower);
    const isVid = /\.(mp4|mkv|asf|flv|rm|avi|wmv|mov)$/.test(nameLower);
    const isPdf = nameLower.endsWith('.pdf');
    const isTxt = nameLower.endsWith('.txt');
    const escapedName = escapeHtml(item.name);
    const escapedLink = escapeHtml(item.rel_link);
    const isFav = favSet.has(item.rel_link);
    const icon = item.is_dir ? "📁" : (isVid ? "🎬" : (isPdf ? "📕" : (isTxt ? "📝" : "📄")));
    const thumb = (item.is_img || isImg) ? `<img src="/download/${escapedLink}" loading="lazy" decoding="async">` : icon;
    let clickAction = "";
    if (item.is_dir) { clickAction = `onclick="goPath('${escapedLink}')"`; }
    else if (isImg) { clickAction = `onclick="previewImage('/download/${escapedLink}')"`; }
    else { clickAction = `onclick="handleFileClick('${escapedLink}', ${isVid}, ${isPdf}, ${isTxt}, '${escapedName}')"`; }
    const favBtn = item.is_dir ? '' : `<button class="btn-star ${isFav?'active':''}" data-rel-link="${escapedLink}" onclick="toggleFav(event, '${escapedLink}', '${escapedName}', this)">★</button>`;
    return `<div class="file-card" ${clickAction}>${favBtn}<div class="thumb-box">${thumb}</div><div class="file-name">${escapedName}</div></div>`;
}

function refreshFileFavIcons() {
    const favSet = new Set(userFavs.map(f => f.rel_link));
    document.querySelectorAll('.btn-star[data-rel-link]').forEach(btn => {
        const link = btn.getAttribute('data-rel-link');
        if (favSet.has(link)) btn.classList.add('active');
        else btn.classList.remove('active');
    });
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
    container.className = isGridLayout ? "file-grid" : "file-list";
    if (!pageItems.length) { container.innerHTML = '<div class="p-5 text-center text-muted w-100">无结果</div>'; return; }

    const renderToken = ++latestRenderToken;
    const favSet = new Set(userFavs.map(f => f.rel_link));
    const chunkSize = 16;
    container.innerHTML = '';

    const renderChunk = (index) => {
        if (renderToken !== latestRenderToken) return;
        const chunk = pageItems.slice(index, index + chunkSize);
        if (!chunk.length) return;
        const html = chunk.map(item => buildFileCardHtml(item, favSet)).join('');
        container.insertAdjacentHTML('beforeend', html);
        if (index + chunkSize < pageItems.length) {
            requestAnimationFrame(() => renderChunk(index + chunkSize));
        }
    };

    renderChunk(0);
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
        let parts = currentPath.split('/');
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
        const payload = isRemoving ? {rel_link: link} : {rel_link: link, name: name, group: '默认'};
        const res = await apiFetch(url, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
        if (res.ok) {
            btn.classList.toggle('active');
            if (isRemoving) { userFavs = userFavs.filter(f => f.rel_link !== link); }
            else { userFavs.push({rel_link: link, name: name, group: '默认', pinned: false}); }
        }
    } catch (e) { console.error(e); }
}

async function syncFavs() {
    const res = await fetch('/api/get_favs');
    if (res.ok) {
        userFavs = await res.json();
        refreshFavGroupFilterOptions();
        renderFavs();
    }
}

function renderFavs() {
    const container = document.getElementById('favContent');
    const filter = document.getElementById('favGroupFilter');
    if (!container) return;
    if (!userFavs.length) { container.innerHTML = '<div class="p-5 text-center text-muted">暂无收藏</div>'; return; }

    const selectedGroup = filter ? filter.value : '';
    const favs = userFavs.filter(f => !selectedGroup || (f.group || '默认') === selectedGroup);
    if (!favs.length) { container.innerHTML = '<div class="p-5 text-center text-muted">该分组暂无收藏</div>'; return; }

    const grouped = {};
    favs.forEach(f => {
        const g = f.group || '默认';
        if (!grouped[g]) grouped[g] = [];
        grouped[g].push(f);
    });

    const groupNames = Object.keys(grouped).sort();
    container.innerHTML = groupNames.map(groupName => {
        const arr = grouped[groupName].sort((a, b) => Number(b.pinned) - Number(a.pinned));
        const rows = arr.map(f => {
            const fLow = f.name.toLowerCase();
            const isVid = /\.(mp4|mkv|asf|flv|rm|avi|wmv|mov)$/.test(fLow);
            const isPdf = fLow.endsWith('.pdf');
            const isTxt = fLow.endsWith('.txt');
            const isImg = /\.(jpg|jpeg|png|gif|webp|bmp)$/.test(fLow);
            const icon = isVid ? "🎬" : (isPdf ? "📕" : (isImg ? "🖼️" : "📄"));
            const thumb = isImg ? `<img src="/download/${escapeHtml(f.rel_link)}">` : icon;
            return `<div class="fav-item" onclick="handleFileClick('${escapeHtml(f.rel_link)}', ${isVid}, ${isPdf}, ${isTxt}, '${escapeHtml(f.name)}')">
                <div class="fav-thumb-container">${thumb}</div>
                <div class="fav-item-info">
                    <div class="fav-item-name">${f.pinned ? '📌 ' : ''}${escapeHtml(f.name)}</div>
                </div>
                <button class="btn-fav-pin" onclick="event.stopPropagation();togglePin('${escapeHtml(f.rel_link)}', ${!!f.pinned})">${f.pinned ? '取消置顶' : '置顶'}</button>
                <button class="btn-fav-group" onclick="event.stopPropagation();moveFavGroup('${escapeHtml(f.rel_link)}')">分组</button>
                <button class="btn-fav-del" onclick="event.stopPropagation(); removeFav('${escapeHtml(f.rel_link)}')">×</button>
            </div>`;
        }).join('');
        return `<div class="fav-group"><div class="fav-group-title">${escapeHtml(groupName)}</div>${rows}</div>`;
    }).join('');
}

async function togglePin(link, currentPinned) {
    const res = await apiFetch('/api/update_fav', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({rel_link: link, pinned: !currentPinned})
    });
    if (res.ok) await syncFavs();
}

async function moveFavGroup(link) {
    openGroupPicker(link);
}

function createFavGroup() {
    const group = prompt('新分组名称');
    if (group === null) return;
    const finalGroup = group.trim();
    if (!finalGroup) return;
    saveCustomFavGroups([...getCustomFavGroups(), finalGroup]);
    refreshFavGroupFilterOptions();
    const filter = document.getElementById('favGroupFilter');
    if (filter) filter.value = finalGroup;
    renderFavs();
}

async function removeFav(link) {
    const res = await apiFetch('/api/del_fav', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({rel_link: link}) });
    if (res.ok) { await syncFavs(); refreshFileFavIcons(); }
}

function updateHistoryMenu() {
    let history = JSON.parse(localStorage.getItem('la_history') || '[]');
    if (currentPath && !history.includes(currentPath)) {
        history.unshift(currentPath);
        if (history.length > 10) history.pop();
        localStorage.setItem('la_history', JSON.stringify(history));
    }
    const list = document.getElementById('historyList');
    const listMobile = document.getElementById('historyListMobile');
    if (!list && !listMobile) return;

    const emptyDesktop = '<li><span class="dropdown-item-text text-muted">无历史记录</span></li>';
    const emptyMobile = '<li class="list-group-item text-muted">无历史记录</li>';
    if (!history.length) {
        if (list) list.innerHTML = emptyDesktop;
        if (listMobile) listMobile.innerHTML = emptyMobile;
        return;
    }

    const rowsDesktop = history.map(h => `<li><a class="dropdown-item text-truncate" style="max-width:280px" href="javascript:void(0)" onclick="openHistoryPath('${escapeHtml(h)}')">${escapeHtml(h || '根目录')}</a></li>`).join('');
    const clearDesktop = `<li><hr class="dropdown-divider"></li><li><a class="dropdown-item text-danger" href="javascript:void(0)" onclick="clearHistoryMenu()">清除历史</a></li>`;
    if (list) list.innerHTML = rowsDesktop + clearDesktop;

    const rowsMobile = history.map(h => `<li class="list-group-item"><a class="text-decoration-none d-block text-truncate" href="javascript:void(0)" onclick="openHistoryPath('${escapeHtml(h)}')">${escapeHtml(h || '根目录')}</a></li>`).join('');
    const clearMobile = `<li class="list-group-item"><a class="text-danger text-decoration-none" href="javascript:void(0)" onclick="clearHistoryMenu()">清除历史</a></li>`;
    if (listMobile) listMobile.innerHTML = rowsMobile + clearMobile;
}

function clearHistoryMenu() {
    localStorage.removeItem('la_history');
    updateHistoryMenu();
}

function openHistoryPath(path) {
    const drawer = document.getElementById('historyDrawer');
    const inst = drawer ? bootstrap.Offcanvas.getInstance(drawer) : null;
    if (inst) inst.hide();
    goPath(path);
}

async function sendMsg() {
    const input = document.getElementById('msgInput');
    const btn = document.getElementById('sendBtn');
    if(!input) return;
    const content = input.value.trim();
    if (!content) return;
    btn.disabled = true;
    try {
        const payload = {msg: content};
        if (replyTarget && replyTarget.id) payload.parent_id = replyTarget.id;
        const res = await apiFetch('/api/send_msg', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload) });
        if (res.ok) { input.value = ''; cancelReply(); await loadChatOnly(true); }
        else { const r = await res.json(); alert(r.msg || "发送失败"); }
    } catch(e) { alert("网络连接失败"); } finally { btn.disabled = false; }
}

function setReplyTarget(id, user, msg) {
    replyTarget = {id, user, msg};
    const hint = document.getElementById('replyHint');
    if (hint) {
        hint.innerHTML = `回复 <strong>${escapeHtml(user)}</strong>: ${escapeHtml((msg || '').slice(0, 50))} <span class="reply-cancel" onclick="cancelReply()">取消</span>`;
        hint.style.display = 'block';
    }
    const input = document.getElementById('msgInput');
    if (input) input.focus();
}

function cancelReply() {
    replyTarget = null;
    const hint = document.getElementById('replyHint');
    if (hint) {
        hint.innerHTML = '';
        hint.style.display = 'none';
    }
}

async function deleteMsg(id) {
    if (!confirm("确定删除此留言？")) return;
    try {
        const res = await apiFetch('/api/del_msg', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: id}) });
        if (res.ok) await loadChatOnly(true);
    } catch(e) { alert("操作失败"); }
}

function getChatSignature(chats) {
    if (!Array.isArray(chats) || chats.length === 0) return "0";
    const first = chats[0];
    const last = chats[chats.length - 1];
    return `${chats.length}-${first.id || ''}-${first.time || ''}-${last.id || ''}-${last.time || ''}`;
}

function getChatItemHash(c) {
    return [
        c.id,
        c.user,
        c.display_name,
        c.msg || c.content,
        c.time,
        c.parent_id,
        c.parent_user,
        c.parent_msg,
        c.is_pinned,
        c.can_delete,
        c.can_pin,
        c.title,
        c.role,
        c.avatar
    ].join('|');
}

function buildChatItemHtml(c) {
    const isSelf = (c.user === currentUser);
    const isAdmin = (c.role === 'admin' || c.role === '管理员' || c.role === '管理員');
    const avatarUrl = c.avatar || getGravatar(c.email, c.user);
    const nameText = c.display_name || c.user;
    return `
        <div class="chat-item" data-chat-id="${c.id}" data-chat-hash="${escapeHtml(getChatItemHash(c))}">
            <div class="chat-left">
                <img src="${avatarUrl}" class="chat-avatar">
                <div class="chat-body">
                    <div class="chat-user-row">
                        <span class="chat-user-name" style="${isAdmin ? 'color: #ff4d4f; font-weight: bold;' : ''}">${escapeHtml(nameText)}</span>
                        ${c.title ? `<span class="title-badge ${isAdmin ? 'bg-danger' : 'bg-primary'}">${escapeHtml(c.title)}</span>` : ''}
                        ${c.is_pinned ? `<span class="chat-pin-badge">置顶</span>` : ''}
                    </div>
                    ${c.parent_id ? `<div class="chat-reply-quote">回复 ${escapeHtml(c.parent_user || '已删除用户')}: ${escapeHtml(c.parent_msg || '')}</div>` : ''}
                    <div class="chat-content">${escapeHtml(c.msg || c.content)}</div>
                </div>
            </div>
            <div class="chat-right">
                <span class="chat-time">${c.time}</span>
                <a href="javascript:void(0)" class="chat-action-link text-primary" onclick="setReplyTarget(${c.id}, '${escapeHtml(c.user)}', '${escapeHtml(c.msg || c.content || '')}')">回复</a>
                ${((userRole === 'admin' || userRole === '管理员' || userRole === '管理員') && c.can_pin) ? `<a href="javascript:void(0)" class="chat-action-link text-warning" onclick="pinMsg(${c.id}, ${c.is_pinned ? 'false' : 'true'})">${c.is_pinned ? '取消置顶' : '置顶'}</a>` : ''}
                ${(isSelf || userRole === 'admin' || userRole === '管理员' || userRole === '管理員') ? `<a href="javascript:void(0)" class="text-danger small ms-2" onclick="deleteMsg(${c.id})">删除</a>` : ''}
            </div>
        </div>`;
}

async function loadChatOnly(force = false) {
    try {
        const res = await fetch(`/api/chat?_t=${Date.now()}`);
        if (!res.ok) return;
        const data = await res.json();
        renderChat(data.chat || [], force);
    } catch (e) {
        console.error(e);
    }
}

function renderChat(chats, force = false) {
    const box = document.getElementById('chatBox');
    if (!chats || !box) return;
    const signature = getChatSignature(chats);
    if (!force && signature === lastChatSignature) return;
    lastChatSignature = signature;
    const existing = new Map();
    box.querySelectorAll('.chat-item[data-chat-id]').forEach(node => {
        existing.set(node.dataset.chatId, node);
    });
    const frag = document.createDocumentFragment();
    chats.forEach(c => {
        const id = String(c.id);
        const hash = getChatItemHash(c);
        let node = existing.get(id);
        if (node && node.dataset.chatHash === hash) {
            frag.appendChild(node);
            return;
        }
        const wrap = document.createElement('div');
        wrap.innerHTML = buildChatItemHtml(c).trim();
        node = wrap.firstElementChild;
        frag.appendChild(node);
    });
    box.replaceChildren(frag);
    if (currentPage === 1) box.scrollTop = box.scrollHeight;
}

async function pinMsg(id, pinned) {
    try {
        const res = await apiFetch('/api/pin_msg', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({id, pinned})
        });
        if (res.ok) await loadChatOnly(true);
    } catch (e) {
        console.error(e);
    }
}
