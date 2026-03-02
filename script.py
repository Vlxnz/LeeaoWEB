import sys, os, threading, json, logging, sqlite3, base64, time, subprocess, shutil
from datetime import datetime, timedelta
from flask import Flask, render_template, request, jsonify, redirect, url_for, Response, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from flask_bcrypt import Bcrypt
from PySide6.QtWidgets import (QApplication, QMainWindow, QVBoxLayout, QWidget, QPushButton,
                               QTableWidget, QTableWidgetItem, QHeaderView, QTabWidget,
                               QTextEdit, QHBoxLayout, QLabel, QLineEdit, QFileDialog, QComboBox, QMessageBox,
                               QCheckBox, QSystemTrayIcon, QMenu, QStyle)
from PySide6.QtCore import Signal, QObject, Qt, QTimer
from PySide6.QtGui import QTextCharFormat, QColor, QFont, QPalette, QIcon, QAction

# --- [修正] 简繁转换初始化：放在全局，确保 Flask 线程能访问 ---
cc = None
try:
    from opencc import OpenCC
    # 使用 s2t (简体转繁体)，确保无论用户输入哪种都能匹配
    cc = OpenCC('s2t')
except Exception as e:
    # 即使加载失败也只是搜索功能变弱，不会导致程序闪退
    print(f"⚠️ OpenCC 加载失败: {e}")

# --- 1. 核心路徑適配 (针对外挂资源优化) ---
if getattr(sys, 'frozen', False):
    # 打包后的 .exe 所在目录
    BASE_DIR = os.path.dirname(sys.executable)
else:
    # 脚本运行时的目录
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# 统一使用 BASE_DIR，不再依赖 BUNDLE_DIR (_MEIPASS)
# 这样 Flask 就会直接在 .exe 旁边寻找 static 和 templates 文件夹
DIRS = {
    'db': os.path.join(BASE_DIR, "instance"),
    'backups': os.path.join(BASE_DIR, "instance", "backups"),
    'static': os.path.join(BASE_DIR, "static"),
    'templates': os.path.join(BASE_DIR, "templates"),
    'avatars': os.path.join(BASE_DIR, "static", "avatars"),
}
os.makedirs(DIRS['db'], exist_ok=True)
os.makedirs(DIRS['backups'], exist_ok=True)
os.makedirs(DIRS['templates'], exist_ok=True)
os.makedirs(DIRS['static'], exist_ok=True)
os.makedirs(DIRS['avatars'], exist_ok=True)

CONFIG_FILE = os.path.join(BASE_DIR, "server_config.json")
DB_PATH = os.path.join(DIRS["db"], "cloud_v3.db")
LOCK_FILE = os.path.join(BASE_DIR, "server.lock")


# --- 2. 核心配置與信號 ---
class Comm(QObject):
    log_msg = Signal(str, str)
    update_ui = Signal()
    status_msg = Signal(str, str)


comm = Comm()
TOTAL_TRAFFIC = 0.0
USER_SPEED_LIMITS = {}
SHARED_DIR = ""
INDEX_LOCK = threading.Lock()
GLOBAL_SEARCH_CACHE = []  # 内存索引缓存


# --- 3. 日誌處理器 ---
class QtLogHandler(logging.Handler):
    def emit(self, record):
        msg = self.format(record)
        level = record.levelname
        color = "#64B5F6" if level == "INFO" else "#FF5252"
        if "[USER_OP]" in msg:
            color = "#FFFFFF"
            msg = msg.replace("[USER_OP]", "")
        comm.log_msg.emit(msg, color)


# --- 4. Flask 初始化 ---
app = Flask(__name__,
            template_folder=DIRS['templates'],
            static_folder=DIRS['static'])
app.config['SECRET_KEY'] = 'leeao-net-v70-final'
app.config['MAX_CONTENT_LENGTH'] = 2 * 1024 * 1024
app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{DB_PATH}'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False


@app.route('/static/avatars/<path:filename>')
def custom_static_avatars(filename):
    return send_from_directory(DIRS['avatars'], filename)


db = SQLAlchemy(app)
bcrypt = Bcrypt(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

flask_logger = logging.getLogger('werkzeug')


def log_user_op(msg):
    flask_logger.info(f"[USER_OP] {msg}")


class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(20), unique=True, nullable=False)
    password = db.Column(db.String(60), nullable=False)
    raw_password = db.Column(db.String(60))
    user_type = db.Column(db.String(20), default="普通用戶")
    custom_title = db.Column(db.String(50), default="")
    email = db.Column(db.String(120), nullable=False)
    avatar_file = db.Column(db.String(200), default="default.png")
    reg_time = db.Column(db.DateTime, default=datetime.now)
    last_login = db.Column(db.DateTime, default=datetime.now)
    total_traffic = db.Column(db.Float, default=0.0)
    last_ip = db.Column(db.String(50), default="未知")


class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50))
    content = db.Column(db.Text)
    timestamp = db.Column(db.DateTime, default=datetime.now)


class Favorite(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    file_name = db.Column(db.String(255), nullable=False)
    rel_link = db.Column(db.Text, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.now)


class FileIndex(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), index=True)
    rel_link = db.Column(db.Text, unique=True)
    is_dir = db.Column(db.Boolean, default=False)
    file_ext = db.Column(db.String(20))


@login_manager.user_loader
def load_user(uid): return db.session.get(User, int(uid))


# --- 運維自動化：自動備份邏輯 ---
def auto_backup():
    try:
        if not os.path.exists(DB_PATH):
            return
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_file = os.path.join(DIRS['backups'], f"backup_{timestamp}.db")
        conn = sqlite3.connect(DB_PATH)
        conn.execute(f"VACUUM INTO '{backup_file}'")
        conn.close()
        comm.log_msg.emit(f"📦 數據庫備份完成: backup_{timestamp}.db", "#81C784")
        now = time.time()
        for f in os.listdir(DIRS['backups']):
            f_path = os.path.join(DIRS['backups'], f)
            if os.path.isfile(f_path) and now - os.path.getmtime(f_path) > 7 * 86400:
                os.remove(f_path)
                comm.log_msg.emit(f"🧹 已清理過期備份: {f}", "#9E9E9E")
    except Exception as e:
        comm.log_msg.emit(f"❌ 備份失敗: {str(e)}", "#FF5252")


# --- 内存加载函数 ---
def load_index_to_memory():
    global GLOBAL_SEARCH_CACHE
    try:
        with app.app_context():
            VID_EXTS = ['.mp4', '.mkv', '.asf', '.flv', '.rm', '.avi', '.wmv', '.mov']
            IMG_EXTS = ['.jpg', '.png', '.gif', '.webp', '.bmp']
            all_items = FileIndex.query.all()
            GLOBAL_SEARCH_CACHE = [{
                'name': i.name,
                'rel_link': i.rel_link,
                'is_dir': i.is_dir,
                'is_img': not i.is_dir and i.file_ext in IMG_EXTS,
                'is_vid': not i.is_dir and i.file_ext in VID_EXTS
            } for i in all_items]
            comm.log_msg.emit(f"🚀 内存搜索引擎就緒 (共 {len(GLOBAL_SEARCH_CACHE)} 項)", "#00E5FF")
    except Exception as e:
        print(f"内存加载出错: {e}")


# --- 核心修改：真正的增量索引邏輯 ---
def rebuild_index():
    global SHARED_DIR
    if not SHARED_DIR or not os.path.exists(SHARED_DIR):
        return
    if not INDEX_LOCK.acquire(blocking=False):
        return
    try:
        with app.app_context():
            comm.log_msg.emit("🔄 正在執行增量掃描 (HDD -> SSD)...", "#FFB74D")
            full_base = os.path.abspath(SHARED_DIR)

            # 1. 掃描硬盤當前狀態
            current_on_disk = {}
            for root, dirs, files in os.walk(full_base):
                dirs[:] = [d for d in dirs if not d.startswith('.')]
                for name in dirs + files:
                    abs_path = os.path.join(root, name)
                    rel_link = os.path.relpath(abs_path, full_base).replace('\\', '/')
                    is_directory = os.path.isdir(abs_path)
                    current_on_disk[rel_link] = (name, is_directory)

            # 2. 獲取數據庫當前狀態
            existing_items = FileIndex.query.all()
            db_links = {item.rel_link: item for item in existing_items}

            # 3. 計算差異
            links_on_disk = set(current_on_disk.keys())
            links_in_db = set(db_links.keys())

            to_add = links_on_disk - links_in_db
            to_remove = links_in_db - links_on_disk

            # 4. 執行增量更新
            if to_remove:
                # 批量刪除數據庫中已失效的鏈接
                FileIndex.query.filter(FileIndex.rel_link.in_(list(to_remove))).delete(synchronize_session=False)

            new_objects = []
            if to_add:
                for link in to_add:
                    name, is_directory = current_on_disk[link]
                    ext = "" if is_directory else os.path.splitext(name)[1].lower()
                    new_objects.append(FileIndex(name=name, rel_link=link, is_dir=is_directory, file_ext=ext))
                db.session.bulk_save_objects(new_objects)

            db.session.commit()

            # 5. 更新完畢後重新加載內存
            load_index_to_memory()
            comm.log_msg.emit(
                f"✅ 增量同步完成 (新增 {len(to_add)} 項，移除 {len(to_remove)} 項，總計 {len(links_on_disk)} 項)",
                "#81C784")
    except Exception as e:
        db.session.rollback()
        comm.log_msg.emit(f"❌ 索引出錯: {str(e)}", "#FF5252")
    finally:
        INDEX_LOCK.release()


# --- 5. 路由邏輯 ---

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        # 💡 使用 .strip() 移除用户名和密码前后可能多余的空格，提高容错率
        uname = request.form.get('username', '').strip()
        pword = request.form.get('password', '').strip()

        # ORM 查询天然防止 SQL 注入，这里非常安全
        u = User.query.filter_by(username=uname).first()

        # 验证密码：支持 Bcrypt 加密或原始密码对比
        if u and (bcrypt.check_password_hash(u.password, pword) or u.raw_password == pword):
            client_ip = request.remote_addr
            u.last_login = datetime.now()
            u.last_ip = client_ip

            login_user(u, remember=True)
            db.session.commit()  # 合并提交，减少数据库锁定

            log_user_op(f"用戶 [{uname}] 登錄成功 (IP: {client_ip})")
            comm.update_ui.emit()

            # 成功后跳转到首页
            return redirect(url_for('index'))

        log_user_op(f"用戶 [{uname}] 嘗試登錄失敗 (來自 IP: {request.remote_addr})")
        return render_template('login.html', error="⚠️ 賬戶或密碼錯誤")
    return render_template('login.html')

# --- 统一退出逻辑：解决 Not Found 并兼容 API ---
@app.route('/logout', methods=['GET', 'POST'])
@app.route('/api/logout', methods=['GET', 'POST'])  # 同时监听两个路径，万无一失
def logout():
    if current_user.is_authenticated:
        name = current_user.username
        logout_user()
        log_user_op(f"用戶 [{name}] 已退出登錄")

    comm.update_ui.emit()

    # 如果是前端直接跳转（GET /logout），则重定向到登录页
    if request.path == '/logout':
        return redirect(url_for('login'))

    # 如果是 API 调用，返回标准 JSON
    return jsonify({'status': 'ok'})


# 下面接你的 @app.route('/register', methods=['POST']) ...


@app.route('/register', methods=['POST'])
def register():
    uname, pword, email = request.form.get('username'), request.form.get('password'), request.form.get('email')
    if not email or User.query.filter_by(username=uname).first():
        return render_template('login.html', error="❌ 註冊失敗: 用戶名已存在或信息不全")
    new_user = User(
        username=uname,
        password=bcrypt.generate_password_hash(pword).decode('utf-8'),
        raw_password=pword,
        email=email,
        last_login=datetime.now(),
        last_ip=request.remote_addr
    )
    db.session.add(new_user)
    db.session.commit()
    login_user(new_user)
    log_user_op(f"新用戶 [{uname}] 註冊成功 (Email: {email}, IP: {request.remote_addr})")
    comm.update_ui.emit()
    return redirect(url_for('index'))


@app.route('/api/data')
@login_required
def api_data():
    current_user.last_ip = request.remote_addr
    db.session.commit()
    rel_path = request.args.get('p', '').strip('/')
    search_q = request.args.get('q', '').strip()
    full_base = os.path.abspath(SHARED_DIR if SHARED_DIR else ".")
    target_dir = os.path.normpath(os.path.join(full_base, rel_path))
    if not target_dir.startswith(full_base):
        return jsonify({'error': 'Access Denied'}), 403

    items = []
    VID_EXTS = ['.mp4', '.mkv', '.asf', '.flv', '.rm', '.avi', '.wmv']
    IMG_EXTS = ['.jpg', '.png', '.gif', '.webp', '.bmp']

    if search_q:
        global cc  # 💡 声明引用全局变量 cc
        q = search_q.lower()
        # 💡 无论用户输入什么，我们都准备好简、繁两种变体
        # 增加 is not None 检查，防止 OpenCC 加载失败时调用 convert 导致二次崩溃
        q_variant = cc.convert(q) if cc is not None else q

        results = []
        for item in GLOBAL_SEARCH_CACHE:
            name_lower = item['name'].lower()
            # 💡 只要文件名命中：原词 OR 转换后的词，都算成功
            if q in name_lower or q_variant in name_lower:
                results.append(item)

            if len(results) >= 500:
                break
        items = results
    else:
        if os.path.exists(target_dir):
            with os.scandir(target_dir) as it:
                for e in it:
                    if e.name.startswith('.'): continue
                    ext = os.path.splitext(e.name)[1].lower()
                    items.append({
                        'name': e.name,
                        'is_dir': e.is_dir(),
                        'rel_link': os.path.join(rel_path, e.name).replace('\\', '/'),
                        'is_img': not e.is_dir() and ext in IMG_EXTS,
                        'is_vid': not e.is_dir() and ext in VID_EXTS
                    })

    cms = Comment.query.order_by(Comment.timestamp.desc()).limit(50).all()
    chat_list = []
    is_admin = current_user.user_type in ['管理員', '管理员']
    for c in cms:
        u_info = User.query.filter_by(username=c.username).first()
        chat_list.append({
            'id': c.id, 'user': c.username, 'email': u_info.email if u_info else "",
            'msg': c.content, 'time': c.timestamp.strftime('%Y-%m-%d %H:%M'),
            'avatar': "https://www.gravatar.com/avatar/?d=identicon",
            'title': u_info.custom_title if u_info else "",
            'role': u_info.user_type if u_info else "普通用戶",
            'can_delete': (current_user.username == c.username or is_admin)
        })

    return jsonify({
        'items': items,
        'user': {
            'name': current_user.username,
            'avatar': "https://www.gravatar.com/avatar/?d=identicon",
            'title': current_user.custom_title,
            'role': current_user.user_type,
            'email': current_user.email
        },
        'chat': chat_list
    })

@app.route('/api/get_favs')
@login_required
def get_favs():
    favs = Favorite.query.filter_by(user_id=current_user.id).all()
    results = []
    VID_EXTS = ['.mp4', '.mkv', '.asf', '.flv', '.rm', '.avi', '.wmv']
    IMG_EXTS = ['.jpg', '.png', '.gif', '.webp', '.bmp']
    for f in favs:
        ext = os.path.splitext(f.file_name)[1].lower()
        results.append({
            'name': f.file_name,
            'rel_link': f.rel_link,
            'is_dir': False,
            'is_img': ext in IMG_EXTS,
            'is_vid': ext in VID_EXTS
        })
    return jsonify(results)


@app.route('/api/add_fav', methods=['POST'])
@login_required
def add_fav():
    data = request.json
    if not Favorite.query.filter_by(user_id=current_user.id, rel_link=data.get('rel_link')).first():
        db.session.add(Favorite(user_id=current_user.id, file_name=data.get('name'), rel_link=data.get('rel_link')))
        db.session.commit()
        comm.update_ui.emit()
    return jsonify({'status': 'ok'})


@app.route('/api/del_fav', methods=['POST'])
@login_required
def del_fav():
    fav = Favorite.query.filter_by(user_id=current_user.id, rel_link=request.json.get('rel_link')).first()
    if fav:
        db.session.delete(fav)
        db.session.commit()
        comm.update_ui.emit()
    return jsonify({'status': 'ok'})


@app.route('/download/<path:filename>')
@login_required
def download_file(filename):
    global TOTAL_TRAFFIC
    full_base = os.path.abspath(SHARED_DIR if SHARED_DIR else ".")
    path = os.path.normpath(os.path.join(full_base, filename))
    if not path.startswith(full_base) or not os.path.exists(path):
        return "文件未找到或訪問受限", 404
    file_size = os.path.getsize(path)
    file_size_mb = file_size / (1024 * 1024)
    range_header = request.headers.get('Range', None)
    should_bill = False
    if range_header:
        if "bytes=0-" in range_header: should_bill = True
    else:
        should_bill = True
    if should_bill:
        TOTAL_TRAFFIC += file_size_mb
        current_user.total_traffic += file_size_mb
        db.session.commit()
        comm.update_ui.emit()
        log_user_op(f"用戶 [{current_user.username}] 消耗流量: {os.path.basename(filename)} ({file_size_mb:.2f} MB)")
    return send_from_directory(full_base, filename, as_attachment=False)


@app.route('/api/send_msg', methods=['POST'])
@login_required
def send_msg():
    msg = request.form.get('msg') or (request.json.get('msg') if request.json else None)
    if not msg: return jsonify({'status': 'error', 'msg': '內容不能為空'}), 400
    now = datetime.now()
    one_min_ago = now - timedelta(minutes=1)
    last_msg = Comment.query.filter(Comment.username == current_user.username, Comment.timestamp > one_min_ago).first()
    if last_msg:
        log_user_op(f"⚠️ 用戶 [{current_user.username}] 嘗試頻繁發言被攔截")
        return jsonify({'status': 'error', 'msg': '發言頻率過快，請一分鐘後再試'}), 429
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = Comment.query.filter(Comment.username == current_user.username,
                                       Comment.timestamp > today_start).count()
    if today_count >= 20:
        log_user_op(f"⚠️ 用戶 [{current_user.username}] 今日發言已達上限")
        return jsonify({'status': 'error', 'msg': '今日發言次數已達上限'}), 403
    if len(msg) > 300:
        return jsonify({'status': 'error', 'msg': '內容過長'}), 400
    new_c = Comment(username=current_user.username, content=msg)
    db.session.add(new_c)
    db.session.commit()
    return jsonify({'status': 'ok'})


@app.route('/api/del_msg', methods=['POST'])
@login_required
def del_msg():
    data = request.json
    mid = data.get('id')
    c = Comment.query.get(mid)
    is_admin = current_user.user_type in ['管理員', '管理员']
    if c and (is_admin or c.username == current_user.username):
        db.session.delete(c)
        db.session.commit()
        return jsonify({'status': 'ok'})
    return jsonify({'status': 'error', 'msg': '權限不足'}), 403


@app.route('/')
@login_required
def index(): return render_template('index.html')


# --- GUI 部分 ---
class AdminGUI(QMainWindow):
    TASK_NAME = "LeeaoResearchNetV70"

    def __init__(self):
        super().__init__()
        self.setWindowTitle("李敖研究網 - 管理終端 V70")
        self.resize(1300, 850)
        self._init_tray()
        self.setStyleSheet("""
            QMainWindow, QWidget { background-color: #1e1e1e; color: #dcdcdc; }
            QTabWidget::pane { border: 1px solid #333; background: #1e1e1e; }
            QTabBar::tab { background: #2d2d2d; padding: 10px 20px; border: 1px solid #333; margin-right: 2px; }
            QTabBar::tab:selected { background: #3d3d3d; border-bottom: 2px solid #b71c1c; }
            QTableWidget { background-color: #252526; gridline-color: #333; color: #dcdcdc; selection-background-color: #3d3d3d; }
            QHeaderView::section { background-color: #333; color: #bbb; padding: 5px; border: 1px solid #222; }
            QLineEdit, QTextEdit { background-color: #2d2d2d; border: 1px solid #444; color: #eee; padding: 5px; }
            QPushButton { background-color: #3e3e42; border: 1px solid #555; padding: 8px; border-radius: 4px; color: #ddd; }
            QPushButton:hover { background-color: #4e4e52; }
            QComboBox { background-color: #2d2d2d; border: 1px solid #444; padding: 3px; color: #eee; }
            QLabel { color: #bbb; }
            QCheckBox { spacing: 8px; color: #bbb; }
            QCheckBox::indicator { width: 18px; height: 18px; }
        """)
        main_layout = QVBoxLayout()
        self.tabs = QTabWidget()
        user_w = QWidget();
        user_l = QVBoxLayout(user_w)
        user_tool_h = QHBoxLayout()
        self.btn_refresh_data = QPushButton("🔄 刷新數據")
        self.btn_refresh_data.setFixedWidth(120);
        self.btn_refresh_data.clicked.connect(self.load_users)
        user_tool_h.addWidget(self.btn_refresh_data);
        user_tool_h.addStretch()
        user_l.addLayout(user_tool_h)
        self.table = QTableWidget(0, 13)
        self.table.setHorizontalHeaderLabels(
            ["ID", "用戶名", "密碼", "郵箱", "權限", "頭銜", "限速", "流量", "最近IP", "註冊日期", "最後登錄", "刪除",
             "保存"])
        header = self.table.horizontalHeader()
        header.setSectionResizeMode(QHeaderView.Interactive)
        self.table.setColumnWidth(0, 40);
        self.table.setColumnWidth(6, 60);
        self.table.setColumnWidth(11, 70);
        self.table.setColumnWidth(12, 70)
        header.setSectionResizeMode(1, QHeaderView.Stretch);
        header.setSectionResizeMode(3, QHeaderView.Stretch)
        user_l.addWidget(self.table);
        self.tabs.addTab(user_w, "👤 賬戶管理")
        self.log_box = QTextEdit();
        self.log_box.setReadOnly(True)
        self.tabs.addTab(self.log_box, "📑 系統日誌")
        conf_w = QWidget();
        conf_l = QVBoxLayout(conf_w)
        self.port_input = QLineEdit("1935");
        self.path_input = QLineEdit()
        conf_l.addWidget(QLabel("端口:"));
        conf_l.addWidget(self.port_input)
        conf_l.addWidget(QLabel("資源路徑:"));
        h_p = QHBoxLayout();
        h_p.addWidget(self.path_input);
        btn_p = QPushButton("📁 選擇目錄");
        btn_p.clicked.connect(self.get_dir);
        h_p.addWidget(btn_p)
        conf_l.addLayout(h_p)

        self.btn_index = QPushButton("⚡ 立即執行增量掃描")
        self.btn_index.setFixedWidth(200)
        self.btn_index.clicked.connect(self.manual_reindex)
        conf_l.addWidget(self.btn_index)

        conf_l.addSpacing(15)
        self.cb_autostart = QCheckBox("🚀 開機靜默自啟")
        self.cb_autostart.stateChanged.connect(self.handle_autostart_change)
        conf_l.addWidget(self.cb_autostart)
        self.html_edit = QTextEdit()
        conf_l.addWidget(QLabel("Index.html 模板編輯器:"));
        conf_l.addWidget(self.html_edit)
        self.tabs.addTab(conf_w, "⚙️ 系統配置")
        self.fav_w = QWidget();
        fav_l = QVBoxLayout(self.fav_w)
        self.fav_table = QTableWidget(0, 3)
        self.fav_table.setHorizontalHeaderLabels(["文件名稱", "全站收藏次數", "路徑"])
        self.fav_table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        fav_l.addWidget(QLabel("⭐ 熱門研究資料收藏排名 (實時統計)"))
        fav_l.addWidget(self.fav_table)
        self.tabs.addTab(self.fav_w, "⭐ 收藏統計")
        main_layout.addWidget(self.tabs)
        bot = QWidget();
        bot_h = QHBoxLayout(bot)
        self.status_dot = QLabel("●");
        self.status_dot.setStyleSheet("color: #F44336; font-size:20px;")
        self.traffic_label = QLabel("總實時流量: 0.00 MB");
        self.op_feedback = QLabel("")
        bot_h.addWidget(self.status_dot);
        bot_h.addWidget(self.traffic_label);
        bot_h.addWidget(self.op_feedback);
        bot_h.addStretch()
        self.btn_start = QPushButton("▶ 啟動服務器");
        self.btn_start.setFixedSize(130, 40)
        self.btn_start.setStyleSheet(
            "background: #2e7d32; color: white; border: none; font-weight:bold; border-radius:4px;")
        self.btn_start.clicked.connect(self.start_srv)
        self.btn_stop = QPushButton("⏸ 停止服務");
        self.btn_stop.setFixedSize(130, 40)
        self.btn_stop.setStyleSheet(
            "background: #c62828; color: white; border: none; font-weight:bold; border-radius:4px;")
        self.btn_stop.clicked.connect(self.stop_srv)
        bot_h.addWidget(self.btn_start);
        bot_h.addWidget(self.btn_stop)
        main_layout.addWidget(bot)
        c = QWidget();
        c.setLayout(main_layout);
        self.setCentralWidget(c)
        comm.log_msg.connect(self.append_log);
        comm.update_ui.connect(self.refresh_all);
        comm.status_msg.connect(self.show_feedback)
        flask_logger.addHandler(QtLogHandler())

        self.backup_timer = QTimer(self)
        self.backup_timer.timeout.connect(auto_backup)
        self.backup_timer.start(86400000)

        self.load_local_config();
        self.load_users();
        self.load_html_file();
        self.check_autostart_status()

        QTimer.singleShot(2000, auto_backup)
        # 💡 程序启动 3 秒后自动同步一次数据库到内存
        QTimer.singleShot(3000, load_index_to_memory)

        if self.path_input.text(): QTimer.singleShot(500, self.start_srv)

    def _init_tray(self):
        self.tray_icon = QSystemTrayIcon(self)
        icon_path = os.path.join(DIRS['static'], "Meihua_ROC.svg.png")
        if os.path.exists(icon_path):
            self.tray_icon.setIcon(QIcon(icon_path))
        else:
            self.tray_icon.setIcon(self.style().standardIcon(QStyle.SP_ComputerIcon))
        tray_menu = QMenu()
        show_action = QAction("顯示界面", self);
        show_action.triggered.connect(self.showNormal)
        quit_action = QAction("徹底退出程序", self);
        quit_action.triggered.connect(self._force_quit)
        tray_menu.addAction(show_action);
        tray_menu.addSeparator();
        tray_menu.addAction(quit_action)
        self.tray_icon.setContextMenu(tray_menu);
        self.tray_icon.activated.connect(self._tray_activated);
        self.tray_icon.show()

    def _tray_activated(self, reason):
        if reason == QSystemTrayIcon.Trigger:
            if self.isVisible():
                self.hide()
            else:
                self.showNormal()

    def _force_quit(self):
        if os.path.exists(LOCK_FILE): os.remove(LOCK_FILE)
        self.tray_icon.hide();
        QApplication.quit()

    def closeEvent(self, event):
        if self.tray_icon.isVisible():
            self.hide();
            self.tray_icon.showMessage("服務器後端運行中", "程序已隱藏至托盤，右鍵可徹底退出。",
                                       QSystemTrayIcon.Information, 2000)
            event.ignore()
        else:
            if os.path.exists(LOCK_FILE): os.remove(LOCK_FILE)
            event.accept()

    def check_autostart_status(self):
        try:
            check_cmd = f'schtasks /query /tn "{self.TASK_NAME}"'
            res = subprocess.run(check_cmd, shell=True, capture_output=True, text=True)
            self.cb_autostart.blockSignals(True);
            self.cb_autostart.setChecked(res.returncode == 0);
            self.cb_autostart.blockSignals(False)
        except:
            pass

    def handle_autostart_change(self, state):
        if state == 2:
            self.setup_windows_autostart()
        else:
            self.remove_windows_autostart()

    def setup_windows_autostart(self):
        exe_path = os.path.abspath(sys.argv[0])
        cmd = f'{sys.executable} "{exe_path}" --silent' if exe_path.endswith('.py') else f'"{exe_path}" --silent'
        try:
            create_cmd = f'schtasks /create /tn "{self.TASK_NAME}" /tr "{cmd}" /sc onstart /ru "SYSTEM" /rl HIGHEST /f'
            res = subprocess.run(create_cmd, shell=True, capture_output=True, text=True)
            if res.returncode == 0: comm.status_msg.emit("✅ 已開啟自啟 (靜默模式)", "#81C784")
        except:
            pass

    def remove_windows_autostart(self):
        try:
            subprocess.run(f'schtasks /delete /tn "{self.TASK_NAME}" /f', shell=True)
        except:
            pass

    def show_feedback(self, text, color):
        self.op_feedback.setText(text);
        self.op_feedback.setStyleSheet(f"color: {color}; font-weight: bold; margin-left: 20px;")
        QTimer.singleShot(3000, lambda: self.op_feedback.setText(""))

    def load_html_file(self):
        p = os.path.join(DIRS['templates'], 'index.html')
        if os.path.exists(p):
            with open(p, 'r', encoding='utf-8') as f: self.html_edit.setPlainText(f.read())

    def get_dir(self):
        p = QFileDialog.getExistingDirectory(self, "選擇資源共享路徑")
        if p:
            self.path_input.setText(p)
            global SHARED_DIR
            SHARED_DIR = p

    def load_users(self):
        with app.app_context():
            try:
                users = User.query.all();
                self.table.setRowCount(len(users))
                for i, u in enumerate(users):
                    self.table.setItem(i, 0, QTableWidgetItem(str(u.id)))
                    self.table.setItem(i, 1, QTableWidgetItem(u.username))
                    self.table.setItem(i, 2, QTableWidgetItem(u.raw_password))
                    mail_edit = QLineEdit(u.email or "");
                    self.table.setCellWidget(i, 3, mail_edit)
                    c = QComboBox();
                    c.addItems(["普通用戶", "管理員"]);
                    c.setCurrentText(u.user_type);
                    self.table.setCellWidget(i, 4, c)
                    t = QLineEdit(u.custom_title);
                    self.table.setCellWidget(i, 5, t)
                    s = QLineEdit(str(USER_SPEED_LIMITS.get(u.username, 0)));
                    self.table.setCellWidget(i, 6, s)
                    self.table.setItem(i, 7, QTableWidgetItem(f"{u.total_traffic:.2f} MB"))
                    self.table.setItem(i, 8, QTableWidgetItem(u.last_ip if u.last_ip else "未知"))
                    self.table.setItem(i, 9, QTableWidgetItem(u.reg_time.strftime('%Y-%m-%d')))
                    ltime = u.last_login.strftime('%Y-%m-%d %H:%M') if u.last_login else "從未登錄"
                    self.table.setItem(i, 10, QTableWidgetItem(ltime))
                    b_d = QPushButton("刪除");
                    b_d.setStyleSheet("background-color: #c62828; color: white; border: none; font-weight: bold;")
                    b_d.clicked.connect(lambda _, x=u.id: self.del_user(x));
                    self.table.setCellWidget(i, 11, b_d)
                    b_s = QPushButton("保存");
                    b_s.setStyleSheet("background-color: #2e7d32; color: white; border: none; font-weight: bold;")
                    b_s.clicked.connect(
                        lambda _, r=i, uid=u.id, em=mail_edit, co=c, tit=t, sp=s: self.save_user(uid, em.text(),
                                                                                                 co.currentText(),
                                                                                                 tit.text(),
                                                                                                 sp.text()));
                    self.table.setCellWidget(i, 12, b_s)
            except:
                pass

    def save_user(self, uid, umail, utype, utitle, uspeed):
        with app.app_context():
            u = db.session.get(User, uid)
            if u:
                u.email = umail;
                u.user_type = utype;
                u.custom_title = utitle;
                db.session.commit()
                try:
                    USER_SPEED_LIMITS[u.username] = int(uspeed)
                except:
                    pass
                comm.status_msg.emit(f"✅ {u.username} 已更新", "#81C784")

    def del_user(self, uid):
        if QMessageBox.question(self, "確認", "確定刪除該用戶？") == QMessageBox.Yes:
            with app.app_context():
                u = db.session.get(User, uid);
                db.session.delete(u);
                db.session.commit();
                self.load_users()

    def start_srv(self):
        global SHARED_DIR;
        SHARED_DIR = self.path_input.text()
        if not SHARED_DIR: return
        self.save_local_config()
        # 啟動時自動跑一次增量同步
        threading.Thread(target=rebuild_index, daemon=True).start()
        threading.Thread(
            target=lambda: app.run(host='0.0.0.0', port=int(self.port_input.text()), threaded=True, use_reloader=False),
            daemon=True).start()
        self.status_dot.setStyleSheet("color: #4CAF50; font-size:20px;")
        self.btn_start.setEnabled(False);
        self.btn_start.setText("🟢 運行中")

    def stop_srv(self):
        self.status_dot.setStyleSheet("color: #F44336; font-size:20px;")
        self.btn_start.setEnabled(True);
        self.btn_start.setText("▶ 啟動服務器")

    def refresh_all(self):
        self.traffic_label.setText(f"總實時流量: {TOTAL_TRAFFIC:.2f} MB")
        self.load_users()
        with app.app_context():
            stats = db.session.query(Favorite.file_name, db.func.count(Favorite.id).label('cnt'),
                                     Favorite.rel_link).group_by(Favorite.rel_link).order_by(db.desc('cnt')).all()
            self.fav_table.setRowCount(len(stats))
            for i, (name, count, link) in enumerate(stats):
                self.fav_table.setItem(i, 0, QTableWidgetItem(name))
                self.fav_table.setItem(i, 1, QTableWidgetItem(str(count)))
                self.fav_table.setItem(i, 2, QTableWidgetItem(link))

    def append_log(self, msg, color):
        fmt = QTextCharFormat();
        fmt.setForeground(QColor(color));
        self.log_box.setCurrentCharFormat(fmt);
        self.log_box.append(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}")

    def save_local_config(self):
        try:
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump({"path": self.path_input.text(), "port": self.port_input.text()}, f)
            hc = self.html_edit.toPlainText().strip()
            if hc:
                with open(os.path.join(DIRS['templates'], 'index.html'), 'w', encoding='utf-8') as f: f.write(hc)
            global SHARED_DIR
            SHARED_DIR = self.path_input.text()
            comm.status_msg.emit("✅ 模板與配置已同步", "#81C784")
        except Exception as e:
            comm.log_msg.emit(f"保存失敗: {str(e)}", "#FF5252")

    def load_local_config(self):
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    cfg = json.load(f);
                    self.path_input.setText(cfg.get("path", ""));
                    self.port_input.setText(cfg.get("port", "1935"))
                    global SHARED_DIR;
                    SHARED_DIR = cfg.get("path", "")
            except:
                pass

    def manual_reindex(self):
        threading.Thread(target=rebuild_index, daemon=True).start()


if __name__ == "__main__":
    import ctypes

    # 1. 设置 Windows 任务栏图标识别码
    app_id = u'leeao.research.net.v70'
    try:
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(app_id)
    except:
        pass

    # 2. 锁文件逻辑 (防止程序多开)
    if os.path.exists(LOCK_FILE):
        try:
            os.remove(LOCK_FILE)
        except:
            # 如果文件被占用删不掉，说明已有程序在运行，直接退出
            sys.exit(0)

    with open(LOCK_FILE, "w") as f:
        f.write(str(os.getpid()))

    # 3. 核心：环境初始化与数据库准备
    with app.app_context():
        # 💡 [安全加固] 显式关闭调试模式，确保发布版安全
        app.debug = False
        # 💡 确保数据库表存在（会读取 instance/ 目录下的数据库）
        db.create_all()

    # 4. 启动 GUI 程序
    q_app = QApplication(sys.argv)
    q_app.setApplicationName("李敖研究網管理終端")

    # 实例化 GUI (此时数据库已就绪，不会报错)
    gui = AdminGUI()

    # 只有在没有 --silent 参数时才显示界面
    if "--silent" not in sys.argv:
        gui.show()

    # 运行程序主循环
    sys.exit(q_app.exec())