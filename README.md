<div align="center">
  <img src="https://raw.githubusercontent.com/Vlxnz/LeeaoWEB/main/logo.ico" width="100" />
  
  <h1>李敖研究網管理終端</h1>
  <p><b>一款基於 Python 的安全、輕量、簡繁兼容型服務器管理與文件分發系統，为李敖研究网服务端，可自行修改作为他用</b></p>
  <p><b>本项目经AI校验</b></p>

  <div>
    <img src="https://img.shields.io/badge/Version-V70-orange" />
    <img src="https://img.shields.io/badge/Python-3.x-blue" />
    <img src="https://img.shields.io/badge/Framework-Flask%20%7C%20PyQt-green" />
    <img src="https://img.shields.io/badge/License-MIT-red" />
  </div>
</div>

<br />

## 📖 項目願景
本項目源於“李敖研究”學術需求，旨在為學術資料提供一套**極致安全**、**零門檻部署**且**具備文化包容性（簡繁兼容）**的分發方案。

---

## 🛠️ 技術架構與原理

### 1. 混合動力架構
系統採用 **"雙引擎"** 設計：
* **後端核心 (Engine)**：Flask 驅動的異步 API 服務，負責高併發文件檢索與數據交互。
* **圖形外殼 (Shell)**：基於 PyQt/PySide 的 GUI 界面，內置進程守護機制與 Lock-File 防多開鎖。

### 2. 簡繁體語義對等搜索
集成 `OpenCC` 工業級轉換引擎。系統在內存中動態生成搜索詞的變體：
> **輸入：** `李敖` &rarr; **動態擴展：** `李敖` (簡) + `李敖` (繁)  
> **匹配：** 確保無論硬盤文件名使用哪種字體，用戶均能一鍵觸達。

---

##  核心功能清單
<ul>
  <li><b>自動路徑記憶</b>：程序自動保存上次共享路徑至 SQLite 數據庫，重啟即連。</li>
  <li><b>多媒體實時預覽</b>：支持 MP4, MKV, JPG, PNG 等主流格式直接在網頁端播放與查看。</li>
  <li><b>學術留言區</b>：具備權限隔離功能的評論系統，支持管理員一鍵清理違規信息。</li>
  <li><b>全自動數據庫維護</b>：啟動時自動檢查並補全 <code>instance</code> 目錄下的數據表結構。</li>
  <li><b>还有很多懒得写了 看截图吧</li>
</ul>

---

##  安全防護體系 (Security Hardening)
本项目在 V70 版本中通過了多維度模擬攻擊測試：

<table>
  <thead>
    <tr>
      <th>維度</th>
      <th>防禦手段</th>
      <th>防護效果</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><b>注入攻擊</b></td>
      <td>SQLAlchemy ORM</td>
      <td>100% 免疫 SQL 注入，過濾所有惡意查詢語法。</td>
    </tr>
    <tr>
      <td><b>跨站脚本 (XSS)</b></td>
      <td>HTML Entity Encoding</td>
      <td>後端對 <code>&lt;script&gt;</code> 等標籤進行轉義存儲，前端文本化渲染。</td>
    </tr>
    <tr>
      <td><b>目錄穿越</b></td>
      <td>Strict Prefix Check</td>
      <td>限制訪問權限僅限於 <code>SHARED_DIR</code> 內部，無法窺探系統目錄。</td>
    </tr>
    <tr>
      <td><b>服務器暴露</b></td>
      <td>Debug Off</td>
      <td>顯式關閉 Flask 調試模式，杜絕交互式控制台被惡意利用。</td>
    </tr>
    <tr>
      <td><b>暴力破解</b></td>
      <td>Minimalist Privilege</td>
      <td>全站無寫入權限接口，黑客登錄後亦無法修改服務器物理文件。</td>
    </tr>
  </tbody>
</table>
<img width="2545" height="1495" alt="image" src="https://github.com/user-attachments/assets/cd68e5d7-31bf-4341-95f8-2d1aeeb30b59" />
<img width="2535" height="1490" alt="image" src="https://github.com/user-attachments/assets/5656dd8c-4a20-4c42-82f0-1fa452187e84" />
<img width="2533" height="1499" alt="image" src="https://github.com/user-attachments/assets/b238a368-8c7a-4a15-8c82-82059753d709" />
<img width="2551" height="1478" alt="image" src="https://github.com/user-attachments/assets/9669ee84-ebbc-4ed7-aa30-63b817bd73b5" />
<img width="2536" height="1494" alt="image" src="https://github.com/user-attachments/assets/b2cab049-368a-4cfd-b3cc-b0bc4dc2dffa" />
<img width="3430" height="1218" alt="image" src="https://github.com/user-attachments/assets/ca502b0e-9b05-4d7a-bfca-25497f3bb105" />

---
##  打包部署流程

### 打包命令
請在環境中執行以下命令生成 EXE：
```powershell
python -m PyInstaller --noconfirm --onedir --windowed --name "服务器管理终端" --icon "logo.ico" --add-data "path/to/opencc/dictionary;opencc/dictionary" --clean script.py
