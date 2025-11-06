const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);

class FileManager {
    constructor() {
        this.tabs = [];
        this.activeTabId = null;
        this.tabIdCounter = 0;
        this.clipboard = null;
        this.clipboardAction = null;
        this.contextMenu = null;
        this.iconSize = 48;
        this.defaultApps = {};
        this.fileTags = {};
        this.customPlaces = [];
        this.thumbnailCache = {};
        
        this.init();
    }

    init() {
        this.loadTags();
        this.loadDefaultApps();
        this.loadCustomPlaces();
        this.setupEventListeners();
        this.loadDevices();
        this.createTab(os.homedir());
        this.updateIconSize();
    }

    setupEventListeners() {
        // Toolbar buttons
        document.getElementById('btn-back').addEventListener('click', () => this.goBack());
        document.getElementById('btn-forward').addEventListener('click', () => this.goForward());
        document.getElementById('btn-up').addEventListener('click', () => this.goUp());
        document.getElementById('btn-new-tab').addEventListener('click', () => {
            const tab = this.getActiveTab();
            this.createTab(tab.currentPath);
        });
        document.getElementById('btn-view').addEventListener('click', () => this.toggleView());
        document.getElementById('btn-split').addEventListener('click', () => this.toggleSplit());
        
        // Search
        const searchBox = document.getElementById('search-box');
        searchBox.addEventListener('input', (e) => {
            clearTimeout(this.searchTimeout);
            this.searchTimeout = setTimeout(() => this.search(e.target.value), 300);
        });

        // Icon size control
        document.getElementById('btn-icon-size').addEventListener('click', (e) => {
            e.stopPropagation();
            const control = document.getElementById('icon-size-control');
            control.classList.toggle('visible');
        });

        document.getElementById('icon-size').addEventListener('input', (e) => {
            this.iconSize = parseInt(e.target.value);
            this.updateIconSize();
        });

        // Address bar double-click to edit
        document.getElementById('addressbar').addEventListener('dblclick', (e) => {
            if (!e.target.classList.contains('breadcrumb')) {
                this.editAddressBar();
            }
        });

        // Sidebar places
        document.querySelectorAll('.sidebar-item[data-path]').forEach(item => {
            item.addEventListener('click', (e) => {
                const pathType = e.currentTarget.dataset.path;
                this.navigateToPlace(pathType);
            });
            
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                this.showPlaceContextMenu(e, pathType);
            });
        });

        // Global click to hide context menu and icon size control
        document.addEventListener('click', (e) => {
            this.hideContextMenu();
            if (!e.target.closest('.icon-size-btn')) {
                document.getElementById('icon-size-control').classList.remove('visible');
            }
            this.renderTabs();
        });
        document.addEventListener('dblclick', (e) => {
            this.hideContextMenu();
            this.renderTabs();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Don't intercept if user is typing in input/textarea
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            if (e.ctrlKey && e.key === 'c') this.copyFiles();
            if (e.ctrlKey && e.key === 'x') this.cutFiles();
            if (e.ctrlKey && e.key === 'v') this.pasteFiles();
            if (e.ctrlKey && e.key === 't') {
                e.preventDefault();
                this.createTab(this.getActiveTab().currentPath);
            }
            if (e.ctrlKey && e.key === 'w') {
                e.preventDefault();
                this.closeTab(this.activeTabId);
            }
            if (e.key === 'Delete') this.deleteFiles();
            if (e.key === 'F5') this.refresh();
        });

        // Auto-focus search on typing
        document.addEventListener('keydown', (e) => {
            const activeElement = document.activeElement;
            if (activeElement.tagName !== 'INPUT' && 
                activeElement.tagName !== 'TEXTAREA' &&
                !e.ctrlKey && !e.altKey && !e.metaKey &&
                e.key.length === 1) {
                const searchBox = document.getElementById('search-box');
                searchBox.focus();
                if (searchBox.value === '') {
                    searchBox.value = e.key;
                }
            }
        });
    }

    // TAB MANAGEMENT
    createTab(initialPath) {
        const tabId = this.tabIdCounter++;
        const tab = {
            id: tabId,
            currentPath: initialPath,
            history: [initialPath],
            historyIndex: 0,
            splitView: false,
            panes: [{ 
                path: initialPath, 
                selectedFiles: new Set(),
                currentArchive: null,
                archiveBasePath: null
            }],
            activePaneIndex: 0,
            viewMode: 'grid',
            sortBy: 'name',
            sortOrder: 'asc',
            isEditing: false,
            editingFile: null
        };

        this.tabs.push(tab);
        this.activeTabId = tabId;
        this.renderTabs();
        this.renderContent();
        return tab;
    }

    closeTab(tabId) {
        const index = this.tabs.findIndex(t => t.id === tabId);
        if (index === -1 || this.tabs.length === 1) return;

        this.tabs.splice(index, 1);
        
        if (this.activeTabId === tabId) {
            this.activeTabId = this.tabs[Math.max(0, index - 1)].id;
        }
        
        this.renderTabs();
        this.renderContent();
    }

    getActiveTab() {
        return this.tabs.find(t => t.id === this.activeTabId);
    }

    renderTabs() {
        const container = document.getElementById('tabs-container');
        container.innerHTML = this.tabs.map(tab => {
            const name = path.basename(tab.currentPath) || tab.currentPath;
            return `
                <div class="tab ${tab.id === this.activeTabId ? 'active' : ''}" data-tab-id="${tab.id}">
                    <span>${name}</span>
                    ${this.tabs.length > 1 ? '<span class="tab-close">×</span>' : ''}
                </div>
            `;
        }).join('');
        
        container.querySelectorAll('.tab').forEach(el => {
            const tabId = parseInt(el.dataset.tabId);
            el.addEventListener('click', (e) => {
                if (!e.target.classList.contains('tab-close')) {
                    this.activeTabId = tabId;
                    this.renderTabs();
                    this.renderContent();
                    console.log(this.tabs[tabId].currentPath);
                }
            });

            const closeBtn = el.querySelector('.tab-close');
            if (closeBtn) {
                closeBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.closeTab(tabId);
                });
            }
        });
        console.log(this.tabs)
        if(this.tabs.length>1){
            container.style.display="flex";
        }
        else{
            container.style.display="none";
        }
    }

    // SPLIT VIEW
    toggleSplit() {
        const tab = this.getActiveTab();
        tab.splitView = !tab.splitView;
        
        if (tab.splitView && tab.panes.length === 1) {
            tab.panes.push({ 
                path: tab.currentPath, 
                selectedFiles: new Set(),
                currentArchive: null,
                archiveBasePath: null
            });
        }
        
        this.renderContent();
    }

    // CONTENT RENDERING
    renderContent() {
        const tab = this.getActiveTab();
        if (!tab) return;
        
        const container = document.getElementById('content-area');
        
        if (tab.isEditing) {
            this.renderTextEditor(container, tab);
            return;
        }

        container.innerHTML = '';
        
        if (tab.splitView) {
            tab.panes.forEach((pane, index) => {
                const paneEl = this.createPane(pane, index);
                container.appendChild(paneEl);
            });
        } else {
            const paneEl = this.createPane(tab.panes[0], 0);
            container.appendChild(paneEl);
            this.loadDirectory(tab.currentPath);
        }

        this.updateAddressBar();
    }

    createPane(pane, index) {
        const tab = this.getActiveTab();
        const paneEl = document.createElement('div');
        paneEl.className = 'pane';
        
        const archiveNotice = document.createElement('div');
        archiveNotice.className = 'archive-notice';
        archiveNotice.id = `archive-notice-${index}`;
        archiveNotice.innerHTML = `
            📦 Viewing archive contents
            <button class="btn btn-primary" onclick="fileManager.extractArchive(${index}, false)">Extract</button>
            <button class="btn btn-primary" onclick="fileManager.extractArchive(${index}, true)">Extract Here</button>
        `;
        
        const fileArea = document.createElement('div');
        fileArea.className = `file-area ${tab.viewMode}-view`;
        fileArea.id = `file-area-${index}`;
        fileArea.dataset.paneIndex = index;
        
        paneEl.appendChild(archiveNotice);
        paneEl.appendChild(fileArea);
        
        this.loadDirectory(pane.path, index);
        this.setupPaneEvents(fileArea, index);
        
        return paneEl;
    }

    setupPaneEvents(fileArea, paneIndex) {
        fileArea.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const tab = this.getActiveTab();
            tab.activePaneIndex = paneIndex;
            this.showContextMenu(e, null);
        });

        // Selection box
        let isSelecting = false;
        let selectionStart = null;
        let selectionBox = null;

        fileArea.addEventListener('mousedown', (e) => {
            if (e.target === fileArea) {
                isSelecting = true;
                selectionStart = { x: e.clientX, y: e.clientY };
                
                selectionBox = document.createElement('div');
                selectionBox.className = 'selection-box';
                document.body.appendChild(selectionBox);
                
                const tab = this.getActiveTab();
                tab.activePaneIndex = paneIndex;
                fileArea.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
                tab.panes[paneIndex].selectedFiles.clear();
                this.updateStatusBar();
            }
        });

        document.addEventListener('mousemove', (e) => {
            if (isSelecting && selectionBox && selectionStart) {
                const x1 = Math.min(selectionStart.x, e.clientX);
                const y1 = Math.min(selectionStart.y, e.clientY);
                const x2 = Math.max(selectionStart.x, e.clientX);
                const y2 = Math.max(selectionStart.y, e.clientY);
                
                selectionBox.style.left = x1 + 'px';
                selectionBox.style.top = y1 + 'px';
                selectionBox.style.width = (x2 - x1) + 'px';
                selectionBox.style.height = (y2 - y1) + 'px';
                
                const selectionRect = { left: x1, top: y1, right: x2, bottom: y2 };
                const tab = this.getActiveTab();
                
                fileArea.querySelectorAll('.file-item').forEach(el => {
                    const rect = el.getBoundingClientRect();
                    const intersects = !(rect.right < selectionRect.left || 
                                        rect.left > selectionRect.right || 
                                        rect.bottom < selectionRect.top || 
                                        rect.top > selectionRect.bottom);
                    
                    if (intersects) {
                        el.classList.add('selected');
                        tab.panes[paneIndex].selectedFiles.add(el.dataset.path); //part 2
                    } else {
                        el.classList.remove('selected');
                        tab.panes[paneIndex].selectedFiles.delete(el.dataset.path);
                    }
                });
                
                this.updateStatusBar();
            }
        });

        document.addEventListener('mouseup', () => {
            if (isSelecting) {
                isSelecting = false;
                selectionStart = null;
                if (selectionBox) {
                    selectionBox.remove();
                    selectionBox = null;
                }
            }
        });
    }

    // NAVIGATION
    navigateToPlace(place) {
        const home = os.homedir();
        const places = {
            home: home,
            desktop: path.join(home, 'Desktop'),
            documents: path.join(home, 'Documents'),
            downloads: path.join(home, 'Downloads'),
            pictures: path.join(home, 'Pictures'),
            music: path.join(home, 'Music'),
            videos: path.join(home, 'Videos')
        };
        
        if (places[place]) {
            const tab = this.getActiveTab();
            this.loadDirectory(places[place], tab.activePaneIndex);
        }
    }

    async loadDevices() {
        try {
            const { stdout } = await execPromise('lsblk -nlo NAME,MOUNTPOINT,SIZE,TYPE');
            const lines = stdout.trim().split('\n');
            const devices = [];
            
            for (const line of lines) {
                const parts = line.trim().split(/\s+/);
                if (parts.length >= 4 && parts[1] && parts[1] !== '/' && parts[3] === 'part') {
                    // Get usage info
                    let usagePercent = 0;
                    try {
                        const { stdout: dfOut } = await execPromise(`df -h "${parts[1]}" | tail -1`);
                        const dfParts = dfOut.trim().split(/\s+/);
                        if (dfParts[4]) {
                            usagePercent = parseInt(dfParts[4].replace('%', ''));
                        }
                    } catch (e) {}

                    devices.push({
                        name: parts[0],
                        mount: parts[1],
                        size: parts[2],
                        usage: usagePercent
                    });
                }
            }

            const devicesHtml = devices.map(dev => 
                `<div class="sidebar-item device-item" data-mount="${dev.mount}" data-device="${dev.name}">
                    💾 ${path.basename(dev.mount)} (${dev.size})
                    <div class="device-usage">
                        <div class="device-usage-bar" style="width: ${dev.usage}%"></div>
                    </div>
                </div>`
            ).join('');
            
            document.getElementById('devices-list').innerHTML = devicesHtml;
            
            document.querySelectorAll('[data-mount]').forEach(item => {
                item.addEventListener('click', (e) => {
                    if (e.target.classList.contains('device-item') || e.target.closest('.device-item')) {
                        const tab = this.getActiveTab();
                        const mountPath = e.currentTarget.dataset.mount || e.target.closest('.device-item').dataset.mount;
                        this.loadDirectory(mountPath, tab.activePaneIndex);
                    }
                });
                
                item.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const deviceEl = e.target.closest('.device-item') || e.currentTarget;
                    this.showDeviceContextMenu(e, deviceEl.dataset.mount, deviceEl.dataset.device);
                });
            });
        } catch (err) {
            console.error('Failed to load devices:', err);
        }
    }

    async loadDirectory(dirPath, paneIndex = 0) {
        const tab = this.getActiveTab();
        const pane = tab.panes[paneIndex];
        const fileArea = document.getElementById(`file-area-${paneIndex}`);
        
        if (!fileArea) return;

        // Clear archive state when loading regular directory
        pane.currentArchive = null;
        pane.archiveBasePath = null;
        const archiveNotice = document.getElementById(`archive-notice-${paneIndex}`);
        if (archiveNotice) {
            archiveNotice.classList.remove('visible');
        }

        this.showLoading(fileArea);

        try {
            const files = fs.readdirSync(dirPath);
            const fileItems = [];

            for (const file of files) {
                try {
                    const fullPath = path.join(dirPath, file);
                    const stats = fs.lstatSync(fullPath);
                    
                    fileItems.push({
                        name: file,
                        path: fullPath,
                        isDirectory: stats.isDirectory(),
                        isSymlink: stats.isSymbolicLink(),
                        size: stats.size,
                        modified: stats.mtime,
                        created: stats.birthtime,
                        mode: stats.mode,
                        uid: stats.uid,
                        gid: stats.gid
                    });
                } catch (err) {
                    console.error(`Error reading ${file}:`, err);
                }
            }

            pane.path = dirPath;
            tab.currentPath = dirPath;
            
            if (!tab.splitView || paneIndex === 0) {
                this.addToHistory(dirPath);
            }
            
            await this.renderFiles(fileItems, paneIndex);
            this.updateAddressBar();
            pane.selectedFiles.clear();
            this.updateStatusBar();
        } catch (err) {
            fileArea.innerHTML = `<div class="loading">Failed to load directory: ${err.message}</div>`;
        }
    }

    async loadArchive(archivePath, paneIndex, subPath = '') {
        const ext = path.extname(archivePath).toLowerCase();
        const archiveTypes = ['.zip', '.tar', '.tar.gz', '.tgz', '.rar'];
        
        if (!archiveTypes.some(type => archivePath.endsWith(type))) {
            return;
        }

        const tab = this.getActiveTab();
        const pane = tab.panes[paneIndex];
        const fileArea = document.getElementById(`file-area-${paneIndex}`);
        
        this.showLoading(fileArea);

        try {
            pane.currentArchive = archivePath;
            if (!pane.archiveBasePath) {
                pane.archiveBasePath = archivePath;
            }
            
            const archiveNotice = document.getElementById(`archive-notice-${paneIndex}`);
            archiveNotice.classList.add('visible');
            archiveNotice.dataset.archive = archivePath;

            let cmd;
            if (archivePath.endsWith('.zip')) {
                cmd = `zipinfo -1 "${pane.archiveBasePath}"`;
            } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
                cmd = `tar -tzf "${pane.archiveBasePath}"`;
            } else if (archivePath.endsWith('.tar')) {
                cmd = `tar -tf "${pane.archiveBasePath}"`;
            } else if (archivePath.endsWith('.rar')) {
                cmd = `unrar lb "${pane.archiveBasePath}"`;
            }

            const { stdout } = await execPromise(cmd);
            const allFiles = stdout.trim().split('\n').filter(f => f);
            
            // Filter files for current subPath
            const prefix = subPath ? subPath + '/' : '';
            const filesInDir = new Set();
            const dirsInDir = new Set();
            
            allFiles.forEach(file => {
                if (file.startsWith(prefix) && file !== prefix) {
                    const relativePath = file.substring(prefix.length);
                    const parts = relativePath.split('/');
                    
                    if (parts.length === 1) {
                        // File in current directory
                        filesInDir.add(relativePath);
                    } else if (parts.length > 1 && parts[0]) {
                        // Subdirectory
                        dirsInDir.add(parts[0]);
                    }
                }
            });
            
            const fileItems = [];
            
            // Add directories
            dirsInDir.forEach(dir => {
                fileItems.push({
                    name: dir,
                    path: prefix + dir,
                    isDirectory: true,
                    isSymlink: false,
                    size: 0,
                    modified: new Date(),
                    created: new Date()
                });
            });
            
            // Add files
            filesInDir.forEach(file => {
                fileItems.push({
                    name: file,
                    path: prefix + file,
                    isDirectory: false,
                    isSymlink: false,
                    size: 0,
                    modified: new Date(),
                    created: new Date()
                });
            });

            pane.path = subPath || '/';
            tab.currentPath = pane.archiveBasePath + ':' + (subPath || '/');
            
            await this.renderFiles(fileItems, paneIndex);
            this.updateAddressBar();
        } catch (err) {
            fileArea.innerHTML = `<div class="loading">Failed to read archive: ${err.message}</div>`;
        }
    }

    async renderFiles(files, paneIndex = 0) {
        const tab = this.getActiveTab();
        const pane = tab.panes[paneIndex];
        const fileArea = document.getElementById(`file-area-${paneIndex}`);
        
        if (!fileArea) return;

        files = this.sortFiles(files, tab.sortBy, tab.sortOrder);
        fileArea.innerHTML = '';

        for (const file of files) {
            const fileEl = await this.createFileElement(file, paneIndex);
            fileArea.appendChild(fileEl);
        }
        
        this.updateStatusBar();
    }

    async createFileElement(file, paneIndex) {
        const tab = this.getActiveTab();
        const pane = tab.panes[paneIndex];
        
        const fileEl = document.createElement('div');
        fileEl.className = 'file-item';
        fileEl.draggable = true;
        fileEl.dataset.path = file.path;
        
        const icon = await this.getFileIcon(file);
        const tag = this.fileTags[file.path];
        
        let infoHtml = '';
        if (tab.viewMode === 'grid') {
            infoHtml = `<div class="file-info">${this.formatSize(file.size)}</div>`;
        }
        
        fileEl.innerHTML = `
            <div class="file-icon-container">
                <div class="file-icon">
                    ${icon}
                    ${file.isSymlink ? '<span class="link-badge">🔗</span>' : ''}
                </div>
            </div>
            <div class="file-name" title="${file.name}">${file.name}</div>
            ${infoHtml}
            ${tag ? `<div class="tag-dot" style="background: ${tag}"></div>` : ''}
        `;

        // Event listeners
        fileEl.addEventListener('click', (e) => this.selectFile(e, file, fileEl, paneIndex));
        fileEl.addEventListener('dblclick', () => this.openFile(file, paneIndex));
        fileEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            tab.activePaneIndex = paneIndex;
            this.selectFile(e, file, fileEl, paneIndex);
            this.showContextMenu(e, file);
        });

        this.setupDragAndDrop(fileEl, file, paneIndex);

        return fileEl;
    }

    setupDragAndDrop(fileEl, file, paneIndex) {
        const tab = this.getActiveTab();
        const pane = tab.panes[paneIndex];
        let dragPreview = null;

        fileEl.addEventListener('dragstart', (e) => {
            fileEl.classList.add('dragging');
            
            dragPreview = document.createElement('div');
            dragPreview.className = 'file-item drag-preview';
            dragPreview.textContent = pane.selectedFiles.size > 1 
                ? `${pane.selectedFiles.size} items` 
                : file.name;
            document.body.appendChild(dragPreview);
            
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', JSON.stringify({
                files: Array.from(pane.selectedFiles),
                sourcePaneIndex: paneIndex
            }));
        });

        fileEl.addEventListener('drag', (e) => {
            if (dragPreview) {
                dragPreview.style.left = e.pageX + 10 + 'px';
                dragPreview.style.top = e.pageY + 10 + 'px';
            }
        });

        fileEl.addEventListener('dragend', () => {
            fileEl.classList.remove('dragging');
            if (dragPreview) {
                dragPreview.remove();
                dragPreview = null;
            }
        });

        fileEl.addEventListener('dragover', (e) => {
            if (file.isDirectory) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                fileEl.classList.add('drag-over');
            }
        });

        fileEl.addEventListener('dragleave', () => {
            fileEl.classList.remove('drag-over');
        });

        fileEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            fileEl.classList.remove('drag-over');
            
            if (file.isDirectory) {
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                this.showDropActionMenu(e, data.files, file.path);
            }
        });
    }

    showDropActionMenu(e, sourceFiles, targetDir) {
        this.hideContextMenu();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        
        const actions = [
            { icon: '📁', label: 'Move Here', action: async () => {
                for (const src of sourceFiles) {
                    const dest = path.join(targetDir, path.basename(src));
                    try {
                        await this.moveFile(src, dest);
                    } catch (err) {
                        alert(`Failed to move: ${err.message}`);
                    }
                }
                this.refresh();
            }},
            { icon: '📋', label: 'Copy Here', action: async () => {
                for (const src of sourceFiles) {
                    const dest = path.join(targetDir, path.basename(src));
                    try {
                        await this.copyFile(src, dest);
                    } catch (err) {
                        alert(`Failed to copy: ${err.message}`);
                    }
                }
                this.refresh();
            }},
            { icon: '🔗', label: 'Link Here', action: async () => {
                for (const src of sourceFiles) {
                    const dest = path.join(targetDir, path.basename(src));
                    try {
                        fs.symlinkSync(src, dest);
                    } catch (err) {
                        alert(`Failed to create link: ${err.message}`);
                    }
                }
                this.refresh();
            }},
            'separator',
            { icon: '✖', label: 'Cancel', action: () => {} }
        ];

        actions.forEach(item => {
            if (item === 'separator') {
                const sep = document.createElement('div');
                sep.className = 'context-menu-separator';
                menu.appendChild(sep);
            } else {
                const menuItem = document.createElement('div');
                menuItem.className = 'context-menu-item';
                menuItem.innerHTML = `${item.icon} ${item.label}`;
                menuItem.addEventListener('click', (e) => {
                    e.stopPropagation();
                    item.action();
                    this.hideContextMenu();
                });
                menu.appendChild(menuItem);
            }
        });

        document.body.appendChild(menu);
        
        const menuRect = menu.getBoundingClientRect();
        let left = e.pageX;
        let top = e.pageY;
        
        if (left + menuRect.width > window.innerWidth) {
            left = window.innerWidth - menuRect.width - 10;
        }
        
        if (top + menuRect.height > window.innerHeight) {
            top = window.innerHeight - menuRect.height - 10;
        }
        
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        
        this.contextMenu = menu;
    }

    sortFiles(files, sortBy, sortOrder) {
        files.sort((a, b) => {
            if (a.isDirectory && !b.isDirectory) return -1;
            if (!a.isDirectory && b.isDirectory) return 1;
            
            let comparison = 0;
            switch (sortBy) {
                case 'name':
                    comparison = a.name.localeCompare(b.name);
                    break;
                case 'size':
                    comparison = a.size - b.size;
                    break;
                case 'modified':
                    comparison = a.modified - b.modified;
                    break;
                case 'created':
                    comparison = a.created - b.created;
                    break;
                case 'type':
                    const extA = path.extname(a.name);
                    const extB = path.extname(b.name);
                    comparison = extA.localeCompare(extB);
                    break;
            }
            
            return sortOrder === 'asc' ? comparison : -comparison;
        });
        
        return files;
    }

    async getFileIcon(file) {
        if (file.isDirectory) {
            try {
                if (!file.path.includes(':')) {  // Not in archive
                    const contents = fs.readdirSync(file.path);
                    return contents.length === 0 ? '📁' : '📂';
                }
            } catch {
                return '📁';
            }
            return '📁';
        }
        
        const ext = path.extname(file.name).toLowerCase();
        
        if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'].includes(ext) && !file.path.includes(':')) {
            return await this.getThumbnail(file.path, 'image');
        }
        
        const icons = {
            '.txt': '📄', '.pdf': '📕', '.doc': '📘', '.docx': '📘',
            '.xls': '📊', '.xlsx': '📊', '.ppt': '📽️', '.pptx': '📽️',
            '.jpg': '🖼️', '.jpeg': '🖼️', '.png': '🖼️', '.gif': '🖼️',
            '.mp3': '🎵', '.wav': '🎵', '.ogg': '🎵',
            '.mp4': '🎬', '.avi': '🎬', '.mkv': '🎬',
            '.zip': '📦', '.tar': '📦', '.gz': '📦', '.rar': '📦',
            '.js': '📜', '.py': '🐍', '.java': '☕', '.cpp': '⚙️',
            '.html': '🌐', '.css': '🎨', '.json': '📋'
        };
        
        return icons[ext] || '📄';
    }

    async getThumbnail(filePath, type) {
        if (this.thumbnailCache[filePath]) {
            return this.thumbnailCache[filePath];
        }

        try {
            if (type === 'image') {
                const img = `<img src="file://${filePath}" onerror="this.style.display='none'">`;
                this.thumbnailCache[filePath] = img;
                return img;
            }
        } catch (err) {
            console.error('Thumbnail generation failed:', err);
        }

        return '📄';
    }

    showLoading(container) {
        container.innerHTML = '<div class="loading-overlay"><div class="loading-spinner"></div></div>';
    }   
//part 3
selectFile(e, file, element, paneIndex) {
    const tab = this.getActiveTab();
    const pane = tab.panes[paneIndex];
    
    if (e.ctrlKey) {
        if (pane.selectedFiles.has(file.path)) {
            pane.selectedFiles.delete(file.path);
            element.classList.remove('selected');
        } else {
            pane.selectedFiles.add(file.path);
            element.classList.add('selected');
        }
    } else if (e.shiftKey && pane.selectedFiles.size > 0) {
        const fileArea = document.getElementById(`file-area-${paneIndex}`);
        const items = Array.from(fileArea.querySelectorAll('.file-item'));
        const lastSelected = Array.from(pane.selectedFiles)[pane.selectedFiles.size - 1];
        const lastIndex = items.findIndex(el => el.dataset.path === lastSelected);
        const currentIndex = items.indexOf(element);
        
        const start = Math.min(lastIndex, currentIndex);
        const end = Math.max(lastIndex, currentIndex);
        
        for (let i = start; i <= end; i++) {
            pane.selectedFiles.add(items[i].dataset.path);
            items[i].classList.add('selected');
        }
    } else {
        const fileArea = document.getElementById(`file-area-${paneIndex}`);
        fileArea.querySelectorAll('.file-item').forEach(el => el.classList.remove('selected'));
        pane.selectedFiles.clear();
        pane.selectedFiles.add(file.path);
        element.classList.add('selected');
    }
    
    this.updateStatusBar();
}

async openFile(file, paneIndex) {
    const tab = this.getActiveTab();
    const pane = tab.panes[paneIndex];
    
    if (pane.currentArchive) {
        // Inside archive
        if (file.isDirectory) {
            // Navigate into subdirectory in archive
            await this.loadArchive(pane.archiveBasePath, paneIndex, file.path);
        }
        // Files in archive cannot be opened directly
        return;
    }
    
    if (file.isDirectory) {
        this.loadDirectory(file.path, paneIndex);
    } else {
        const ext = path.extname(file.name).toLowerCase();
        if (['.zip', '.tar', '.tar.gz', '.tgz', '.rar'].some(type => file.name.endsWith(type))) {
            await this.loadArchive(file.path, paneIndex);
        } else if (['.txt', '.js', '.json', '.html', '.css', '.py', '.md', '.sh', '.xml', '.log'].includes(ext)) {
            this.openInTextEditor(file);
        } else {
            if (this.defaultApps[ext]) {
                exec(`${this.defaultApps[ext]} "${file.path}"`);
            } else {
                exec(`xdg-open "${file.path}"`);
            }
        }
    }
}

showContextMenu(e, file) {
    this.hideContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    
    const items = file ? this.getFileContextMenuItems(file) : this.getEmptyContextMenuItems();
    
    items.forEach(item => {
        if (item === 'separator') {
            const sep = document.createElement('div');
            sep.className = 'context-menu-separator';
            menu.appendChild(sep);
        } else {
            const menuItem = document.createElement('div');
            menuItem.className = 'context-menu-item';
            menuItem.innerHTML = item.html || `${item.icon} ${item.label}`;
            menuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                item.action();
                this.hideContextMenu();
            });
            menu.appendChild(menuItem);

            if (item.submenu) {
                menuItem.classList.add('context-menu-submenu');
                menuItem.addEventListener('mouseenter', () => {
                    // Close any existing submenus
                    document.querySelectorAll('.context-menu .context-menu').forEach(sm => sm.remove());
                    this.showSubmenu(menuItem, item.submenu);
                });
            }
        }
    });

    document.body.appendChild(menu);
    
    const menuRect = menu.getBoundingClientRect();
    let left = e.pageX;
    let top = e.pageY;
    
    if (left + menuRect.width > window.innerWidth) {
        left = window.innerWidth - menuRect.width - 10;
    }
    
    if (top + menuRect.height > window.innerHeight) {
        top = window.innerHeight - menuRect.height - 10;
    }
    
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    
    this.contextMenu = menu;
}

showSubmenu(parent, items) {
    const submenu = document.createElement('div');
    submenu.className = 'context-menu';
    submenu.style.position = 'absolute';
    submenu.style.left = '100%';
    submenu.style.top = '0';

    items.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.className = 'context-menu-item';
        menuItem.innerHTML = item.html || item.label;
        menuItem.addEventListener('click', (e) => {
            e.stopPropagation();
            item.action();
            this.hideContextMenu();
        });
        submenu.appendChild(menuItem);
    });

    parent.appendChild(submenu);
    
    const rect = submenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        submenu.style.left = 'auto';
        submenu.style.right = '100%';
    }
    if (rect.bottom > window.innerHeight) {
        submenu.style.top = 'auto';
        submenu.style.bottom = '0';
    }
}

getFileContextMenuItems(file) {
    const ext = path.extname(file.name).toLowerCase();
    const isTextFile = ['.txt', '.js', '.json', '.html', '.css', '.py', '.md', '.sh', '.xml', '.log'].includes(ext);
    
    const items = [
        { icon: '📂', label: 'Open', action: () => {
            const tab = this.getActiveTab();
            this.openFile(file, tab.activePaneIndex);
        }},
    ];
    
    if (isTextFile) {
        items.push({ icon: '✏️', label: 'Edit Text', action: () => this.openInTextEditor(file) });
    }
    
    items.push(
        { icon: '📱', label: 'Open With', action: () => this.openWith(file) },
        { icon: '🔑', label: 'Open as Root', action: () => this.openAsRoot(file) },
        'separator',
        { icon: '✏️', label: 'Rename', action: () => this.renameFile(file) },
        { icon: '📋', label: 'Copy', action: () => this.copyFiles() },
        { icon: '✂️', label: 'Cut', action: () => this.cutFiles() },
        { icon: '🗑️', label: 'Delete', action: () => this.deleteFiles() },
        'separator',
        { icon: '📦', label: 'Compress', action: () => this.compressFiles() },
        { icon: '🏷️', label: 'Tag Color', submenu: this.getColorSubmenu(file) },
        { icon: '📍', label: 'Copy Path', action: () => this.copyPath(file) },
        'separator',
        { icon: '⚙️', label: 'Properties', action: () => this.showProperties(file) }
    );
    
    return items;
}

getEmptyContextMenuItems() {
    return [
        { icon: '📋', label: 'Paste', action: () => this.pasteFiles() },
        'separator',
        { icon: '📄', label: 'New File', action: () => this.createNew('file') },
        { icon: '📁', label: 'New Folder', action: () => this.createNew('folder') },
        'separator',
        { icon: '⌨️', label: 'Open Terminal Here', action: () => this.openTerminal() },
        { icon: '🔄', label: 'Sort By', submenu: [
            { label: 'Name (A-Z)', action: () => this.setSorting('name', 'asc') },
            { label: 'Name (Z-A)', action: () => this.setSorting('name', 'desc') },
            { label: 'Size (Small to Large)', action: () => this.setSorting('size', 'asc') },
            { label: 'Size (Large to Small)', action: () => this.setSorting('size', 'desc') },
            { label: 'Date Modified (Oldest)', action: () => this.setSorting('modified', 'asc') },
            { label: 'Date Modified (Newest)', action: () => this.setSorting('modified', 'desc') },
            { label: 'Date Created (Oldest)', action: () => this.setSorting('created', 'asc') },
            { label: 'Date Created (Newest)', action: () => this.setSorting('created', 'desc') },
            { label: 'Type', action: () => this.setSorting('type', 'asc') }
        ]},
        { icon: '👁️', label: 'View', submenu: [
            { label: 'Grid View', action: () => this.setView('grid') },
            { label: 'List View', action: () => this.setView('list') }
        ]},
        'separator',
        { icon: '🔄', label: 'Refresh', action: () => this.refresh() }
    ];
}

getColorSubmenu(file) {
    const colors = [
        { name: 'None', color: null },
        { name: 'Red', color: '#ff4444' },
        { name: 'Orange', color: '#ff8844' },
        { name: 'Yellow', color: '#ffcc44' },
        { name: 'Green', color: '#44ff88' },
        { name: 'Blue', color: '#4488ff' },
        { name: 'Purple', color: '#8844ff' },
        { name: 'Pink', color: '#ff44cc' }
    ];

    return colors.map(c => ({
        html: `<span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${c.color || '#666'};margin-right:8px;"></span>${c.name}`,
        action: () => this.tagFile(file, c.color)
    }));
}

showPlaceContextMenu(e, place) {
    e.stopPropagation();
    this.hideContextMenu();

    const home = os.homedir();
    const places = {
        home: home,
        desktop: path.join(home, 'Desktop'),
        documents: path.join(home, 'Documents'),
        downloads: path.join(home, 'Downloads'),
        pictures: path.join(home, 'Pictures'),
        music: path.join(home, 'Music'),
        videos: path.join(home, 'Videos')
    };

    const menu = document.createElement('div');
    menu.className = 'context-menu';

    const items = [
        { icon: '📂', label: 'Open', action: () => this.navigateToPlace(place) },
        'separator',
        { icon: '📌', label: 'Add to Custom Places', action: () => this.addToCustomPlaces(places[place]) }
    ];

    this.renderContextMenuItems(menu, items, e);
}

showDeviceContextMenu(e, mountPath, deviceName) {
    e.stopPropagation();
    this.hideContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';

    const items = [
        { icon: '📂', label: 'Open', action: () => {
            const tab = this.getActiveTab();
            this.loadDirectory(mountPath, tab.activePaneIndex);
        }},
        { icon: '⏏️', label: 'Unmount', action: () => this.unmountDevice(deviceName, mountPath) },
        'separator',
        { icon: '⚙️', label: 'Properties', action: () => this.showDeviceProperties(mountPath, deviceName) }
    ];

    this.renderContextMenuItems(menu, items, e);
}

renderContextMenuItems(menu, items, e) {
    items.forEach(item => {
        if (item === 'separator') {
            const sep = document.createElement('div');
            sep.className = 'context-menu-separator';
            menu.appendChild(sep);
        } else {
            const menuItem = document.createElement('div');
            menuItem.className = 'context-menu-item';
            menuItem.innerHTML = `${item.icon} ${item.label}`;
            menuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                item.action();
                this.hideContextMenu();
            });
            menu.appendChild(menuItem);
        }
    });

    document.body.appendChild(menu);
    
    const menuRect = menu.getBoundingClientRect();
    let left = e.pageX;
    let top = e.pageY;
    
    if (left + menuRect.width > window.innerWidth) {
        left = window.innerWidth - menuRect.width - 10;
    }
    
    if (top + menuRect.height > window.innerHeight) {
        top = window.innerHeight - menuRect.height - 10;
    }
    
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    
    this.contextMenu = menu;
}

hideContextMenu() {
    if (this.contextMenu) {
        this.contextMenu.remove();
        this.contextMenu = null;
    }
}

// FILE OPERATIONS
copyFiles() {
    const tab = this.getActiveTab();
    const pane = tab.panes[tab.activePaneIndex];
    if (pane.selectedFiles.size === 0) return;
    this.clipboard = Array.from(pane.selectedFiles);
    this.clipboardAction = 'copy';
}

cutFiles() {
    const tab = this.getActiveTab();
    const pane = tab.panes[tab.activePaneIndex];
    if (pane.selectedFiles.size === 0) return;
    this.clipboard = Array.from(pane.selectedFiles);
    this.clipboardAction = 'cut';
}

async pasteFiles() {
    if (!this.clipboard || this.clipboard.length === 0) return;

    const tab = this.getActiveTab();
    const pane = tab.panes[tab.activePaneIndex];

    for (const srcPath of this.clipboard) {
        const fileName = path.basename(srcPath);
        const destPath = path.join(pane.path, fileName);

        try {
            if (this.clipboardAction === 'copy') {
                await this.copyFile(srcPath, destPath);
            } else if (this.clipboardAction === 'cut') {
                await this.moveFile(srcPath, destPath);
            }
        } catch (err) {
            alert(`Failed to paste ${fileName}: ${err.message}`);
        }
    }

    if (this.clipboardAction === 'cut') {
        this.clipboard = null;
        this.clipboardAction = null;
    }

    this.refresh();
}

async copyFile(src, dest) {
    return new Promise((resolve, reject) => {
        const stats = fs.statSync(src);
        if (stats.isDirectory()) {
            exec(`cp -r "${src}" "${dest}"`, (err) => {
                if (err) reject(err);
                else resolve();
            });
        } else {
            fs.copyFile(src, dest, (err) => {
                if (err) reject(err);
                else resolve();
            });
        }
    });
}

async moveFile(src, dest) {
    return new Promise((resolve, reject) => {
        fs.rename(src, dest, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

async deleteFiles() {
    const tab = this.getActiveTab();
    const pane = tab.panes[tab.activePaneIndex];
    if (pane.selectedFiles.size === 0) return;

    const confirmed = confirm(`Delete ${pane.selectedFiles.size} item(s)?`);
    if (!confirmed) return;

    for (const filePath of pane.selectedFiles) {
        try {
            const stats = fs.statSync(filePath);
            if (stats.isDirectory()) {
                await execPromise(`rm -rf "${filePath}"`);
            } else {
                fs.unlinkSync(filePath);
            }
        } catch (err) {
            alert(`Failed to delete ${path.basename(filePath)}: ${err.message}`);
        }
    }

    pane.selectedFiles.clear();
    this.refresh();
}

copyPath(file) {
    const clipboard = nw.Clipboard.get();
    clipboard.set(file.path, 'text');
}

tagFile(file, color) {
    if (color) {
        this.fileTags[file.path] = color;
    } else {
        delete this.fileTags[file.path];
    }
    this.saveTags();
    this.refresh();
}

renameFile(file) {
    this.showModal(
        'Rename',
        `<input type="text" class="input-field" id="rename-input" value="${file.name}">`,
        async () => {
            const newName = document.getElementById('rename-input').value.trim();
            if (!newName || newName === file.name) return;

            const newPath = path.join(path.dirname(file.path), newName);
            try {
                await this.moveFile(file.path, newPath);
                this.refresh();
            } catch (err) {
                alert('Failed to rename: ' + err.message);
            }
        }
    );
    
    // Auto-select filename without extension
    setTimeout(() => {
        const input = document.getElementById('rename-input');
        if (input) {
            const lastDot = file.name.lastIndexOf('.');
            if (lastDot > 0) {
                input.setSelectionRange(0, lastDot);
            } else {
                input.select();
            }
            input.focus();
        }
    }, 100);
}

formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
//part 4
updateAddressBar() {
    const tab = this.getActiveTab();
    const pane = tab.panes[tab.activePaneIndex];
    const addressBar = document.getElementById('addressbar');
    const content = document.getElementById('addressbar-content');
    addressBar.classList.remove('editing');
    content.innerHTML = '';

    // Handle archive paths
    if (pane.currentArchive) {
        const archiveName = path.basename(pane.archiveBasePath);
        const subPath = pane.path || '/';
        
        // Archive root breadcrumb
        const archiveBreadcrumb = document.createElement('div');
        archiveBreadcrumb.className = 'breadcrumb';
        archiveBreadcrumb.textContent = `📦 ${archiveName}`;
        archiveBreadcrumb.addEventListener('click', () => {
            this.loadArchive(pane.archiveBasePath, tab.activePaneIndex, '');
        });
        content.appendChild(archiveBreadcrumb);
        
        // Subdirectories in archive
        if (subPath !== '/') {
            const parts = subPath.split('/').filter(p => p);
            let currentPath = '';
            parts.forEach((part) => {
                currentPath += (currentPath ? '/' : '') + part;
                const breadcrumb = document.createElement('div');
                breadcrumb.className = 'breadcrumb';
                breadcrumb.textContent = part;
                
                const fullPath = currentPath;
                breadcrumb.addEventListener('click', () => {
                    this.loadArchive(pane.archiveBasePath, tab.activePaneIndex, fullPath);
                });
                
                content.appendChild(breadcrumb);
            });
        }
        return;
    }

    // Regular directory paths
    const parts = tab.currentPath.split('/').filter(p => p);
    parts.unshift('');

    const maxWidth = addressBar.clientWidth - 100;
    let breadcrumbs = [];
    let currentPath = '';
    
    parts.forEach((part, index) => {
        currentPath += (index === 0 ? '' : '/') + part;
        const breadcrumb = document.createElement('div');
        breadcrumb.className = 'breadcrumb';
        breadcrumb.textContent = part || '/';
        
        const fullPath = currentPath || '/';
        breadcrumb.addEventListener('click', () => {
            this.loadDirectory(fullPath, tab.activePaneIndex);
        });

        breadcrumbs.push({ element: breadcrumb, width: breadcrumb.textContent.length * 8 });
    });

    // Show ellipsis if path is too long
    let totalWidth = breadcrumbs.reduce((sum, b) => sum + b.width, 0);
    let startIndex = 0;
    
    if (totalWidth > maxWidth) {
        for (let i = 1; i < breadcrumbs.length - 1; i++) {
            totalWidth -= breadcrumbs[i].width;
            if (totalWidth <= maxWidth) {
                startIndex = i;
                break;
            }
        }
        
        if (startIndex > 0) {
            const ellipsis = document.createElement('div');
            ellipsis.className = 'breadcrumb';
            ellipsis.textContent = '...';
            content.appendChild(ellipsis);
        }
    }

    for (let i = Math.max(0, startIndex); i < breadcrumbs.length; i++) {
        content.appendChild(breadcrumbs[i].element);
    }
}

editAddressBar() {
    const tab = this.getActiveTab();
    const addressBar = document.getElementById('addressbar');
    addressBar.classList.add('editing');
    addressBar.innerHTML = '';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'addressbar-input';
    input.value = tab.currentPath;
    
    addressBar.appendChild(input);
    input.focus();
    input.select();
    
    const handleSubmit = () => {
        const newPath = input.value.trim();
        if (newPath && fs.existsSync(newPath)) {
            this.loadDirectory(newPath, tab.activePaneIndex);
        } else {
            this.updateAddressBar();
        }
    };
    
    input.addEventListener('blur', handleSubmit);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            handleSubmit();
        } else if (e.key === 'Escape') {
            this.updateAddressBar();
        }
    });
}

updateIconSize() {
    const size = this.iconSize;
    document.querySelectorAll('.file-area').forEach(area => {
        area.style.setProperty('--icon-size', size + 'px');
        area.style.setProperty('--item-size', (size + 40) + 'px');
    });
}

async updateStatusBar() {
    const tab = this.getActiveTab();
    const pane = tab.panes[tab.activePaneIndex];
    const selectedCount = pane.selectedFiles.size;

    document.getElementById('status-selection').textContent = 
        selectedCount === 0 ? 'No items selected' : 
        selectedCount === 1 ? '1 item selected' : 
        `${selectedCount} items selected`;

    if (selectedCount === 1) {
        const filePath = Array.from(pane.selectedFiles)[0];
        try {
            const stats = fs.lstatSync(filePath);
            const size = this.formatSize(stats.size);
            const permissions = (stats.mode & parseInt('777', 8)).toString(8);
            const modified = stats.mtime.toLocaleDateString();
            const created = stats.birthtime.toLocaleDateString();
            
            let owner = '';
            try {
                const { stdout } = await execPromise(`stat -c '%U:%G' "${filePath}"`);
                owner = stdout.trim();
            } catch (err) {}

            document.getElementById('status-size').textContent = `Size: ${size}`;
            document.getElementById('status-perms').textContent = `Perms: ${permissions}`;
            document.getElementById('status-owner').textContent = owner ? `Owner: ${owner}` : '';
            document.getElementById('status-created').textContent = `Created: ${created}`;
            document.getElementById('status-modified').textContent = `Modified: ${modified}`;
        } catch (err) {
            this.clearStatusBar();
        }
    } else {
        this.clearStatusBar();
    }
}

clearStatusBar() {
    document.getElementById('status-size').textContent = '';
    document.getElementById('status-perms').textContent = '';
    document.getElementById('status-owner').textContent = '';
    document.getElementById('status-created').textContent = '';
    document.getElementById('status-modified').textContent = '';
}

async search(query) {
    const tab = this.getActiveTab();
    const pane = tab.panes[tab.activePaneIndex];
    const fileArea = document.getElementById(`file-area-${tab.activePaneIndex}`);
    
    if (!query.trim()) {
        this.refresh();
        return;
    }

    this.showLoading(fileArea);

    try {
        // First: search current folder only
        const currentFiles = fs.readdirSync(pane.path).filter(f => 
            f.toLowerCase().includes(query.toLowerCase())
        );

        const currentResults = [];
        for (const file of currentFiles) {
            try {
                const fullPath = path.join(pane.path, file);
                const stats = fs.lstatSync(fullPath);
                currentResults.push({
                    name: file,
                    path: fullPath,
                    isDirectory: stats.isDirectory(),
                    isSymlink: stats.isSymbolicLink(),
                    size: stats.size,
                    modified: stats.mtime,
                    created: stats.birthtime,
                    mode: stats.mode,
                    uid: stats.uid,
                    gid: stats.gid
                });
            } catch (err) {}
        }

        // Show current folder results immediately
        if (currentResults.length > 0) {
            await this.renderFiles(currentResults, tab.activePaneIndex);
        }

        // Then: deep search in background
        setTimeout(async () => {
            try {
                const { stdout } = await execPromise(`find "${pane.path}" -iname "*${query}*" 2>/dev/null | head -n 200`);
                const results = stdout.trim().split('\n').filter(f => f);

                const fileItems = [];
                for (const filePath of results) {
                    try {
                        const stats = fs.lstatSync(filePath);
                        fileItems.push({
                            name: path.basename(filePath),
                            path: filePath,
                            isDirectory: stats.isDirectory(),
                            isSymlink: stats.isSymbolicLink(),
                            size: stats.size,
                            modified: stats.mtime,
                            created: stats.birthtime,
                            mode: stats.mode,
                            uid: stats.uid,
                            gid: stats.gid
                        });
                    } catch (err) {}
                }

                await this.renderFiles(fileItems, tab.activePaneIndex);
            } catch (err) {
                console.error('Deep search failed:', err);
            }
        }, 100);
    } catch (err) {
        fileArea.innerHTML = '<div class="loading">Search failed</div>';
    }
}

// HISTORY & NAVIGATION
addToHistory(dirPath) {
    const tab = this.getActiveTab();
    if (tab.history[tab.historyIndex] !== dirPath) {
        tab.history = tab.history.slice(0, tab.historyIndex + 1);
        tab.history.push(dirPath);
        tab.historyIndex = tab.history.length - 1;
    }
}

goBack() {
    const tab = this.getActiveTab();
    if (tab.historyIndex > 0) {
        tab.historyIndex--;
        tab.currentPath = tab.history[tab.historyIndex];
        this.loadDirectory(tab.currentPath, tab.activePaneIndex);
    }
}

goForward() {
    const tab = this.getActiveTab();
    if (tab.historyIndex < tab.history.length - 1) {
        tab.historyIndex++;
        tab.currentPath = tab.history[tab.historyIndex];
        this.loadDirectory(tab.currentPath, tab.activePaneIndex);
    }
}

goUp() {
    const tab = this.getActiveTab();
    const pane = tab.panes[tab.activePaneIndex];
    
    if (pane.currentArchive) {
        // Go up in archive
        if (pane.path === '/' || pane.path === '') {
            // Exit archive
            this.loadDirectory(path.dirname(pane.archiveBasePath), tab.activePaneIndex);
        } else {
            // Go up one level in archive
            const parentPath = pane.path.split('/').slice(0, -1).join('/');
            this.loadArchive(pane.archiveBasePath, tab.activePaneIndex, parentPath);
        }
    } else {
        const parent = path.dirname(tab.currentPath);
        if (parent !== tab.currentPath) {
            this.loadDirectory(parent, tab.activePaneIndex);
        }
    }
}

refresh() {
    const tab = this.getActiveTab();
    tab.panes.forEach((pane, index) => {
        if (pane.currentArchive) {
            this.loadArchive(pane.archiveBasePath, index, pane.path);
        } else {
            this.loadDirectory(pane.path, index);
        }
    });
}

setSorting(sortBy, sortOrder) {
    const tab = this.getActiveTab();
    tab.sortBy = sortBy;
    tab.sortOrder = sortOrder;
    this.refresh();
}

toggleView() {
    const tab = this.getActiveTab();
    tab.viewMode = tab.viewMode === 'grid' ? 'list' : 'grid';
    this.setView(tab.viewMode);
}

setView(mode) {
    const tab = this.getActiveTab();
    tab.viewMode = mode;
    
    document.querySelectorAll('.file-area').forEach(area => {
        area.className = `file-area ${mode}-view`;
    });
    
    document.getElementById('btn-view').textContent = mode === 'grid' ? 'Grid' : 'List';
}

// ADDITIONAL ACTIONS
createNew(type) {
    this.showModal(
        type === 'file' ? 'New File' : 'New Folder',
        `<input type="text" class="input-field" id="new-name" placeholder="Enter name...">`,
        () => {
            const name = document.getElementById('new-name').value.trim();
            if (!name) return;

            const tab = this.getActiveTab();
            const pane = tab.panes[tab.activePaneIndex];
            const newPath = path.join(pane.path, name);
            
            try {
                if (type === 'file') {
                    fs.writeFileSync(newPath, '');
                } else {
                    fs.mkdirSync(newPath);
                }
                this.refresh();
            } catch (err) {
                alert('Failed to create: ' + err.message);
            }
        }
    );
}

openTerminal() {
    const tab = this.getActiveTab();
    const pane = tab.panes[tab.activePaneIndex];
    const terminals = ['gnome-terminal', 'konsole', 'xfce4-terminal', 'xterm'];
    
    for (const term of terminals) {
        try {
            exec(`which ${term}`, (err) => {
                if (!err) {
                    exec(`${term} --working-directory="${pane.path}"`);
                    return;
                }
            });
        } catch (err) {
            continue;
        }
    }
}

openAsRoot(file) {
    const confirmed = confirm('Open as root? This requires your password.');
    if (!confirmed) return;
    exec(`pkexec xdg-open "${file.path}"`);
}

openWith(file) {
    this.showModal(
        'Open With',
        `<input type="text" class="input-field" id="app-command" placeholder="Enter application command (e.g., gedit, vlc)">
         <label style="display: flex; align-items: center; gap: 8px; margin-top: 8px;">
            <input type="checkbox" id="set-default">
            <span style="font-size: 13px;">Set as default for ${path.extname(file.name)} files</span>
         </label>`,
        () => {
            const command = document.getElementById('app-command').value.trim();
            const setDefault = document.getElementById('set-default').checked;
            
            if (!command) return;

            exec(`${command} "${file.path}"`, (err) => {
                if (err) alert('Failed to open file: ' + err.message);
            });

            if (setDefault) {
                const ext = path.extname(file.name);
                this.defaultApps[ext] = command;
                this.saveDefaultApps();
            }
        }
    );
}

async compressFiles() {
    const tab = this.getActiveTab();
    const pane = tab.panes[tab.activePaneIndex];
    if (pane.selectedFiles.size === 0) return;

    this.showModal(
        'Compress Files',
        `<input type="text" class="input-field" id="archive-name" placeholder="archive" value="archive">
         <select class="input-field" id="archive-format">
            <option value="tar.gz">tar.gz</option>
            <option value="zip">zip</option>
            <option value="tar">tar</option>
         </select>`,
        async () => {
            const name = document.getElementById('archive-name').value.trim() || 'archive';
            const format = document.getElementById('archive-format').value;
            const archivePath = path.join(pane.path, `${name}.${format}`);

            const files = Array.from(pane.selectedFiles).map(f => `"${path.basename(f)}"`).join(' ');

            try {
                let cmd;
                if (format === 'tar.gz') {
                    cmd = `cd "${pane.path}" && tar -czf "${archivePath}" ${files}`;
                } else if (format === 'zip') {
                    cmd = `cd "${pane.path}" && zip -r "${archivePath}" ${files}`;
                } else if (format === 'tar') {
                    cmd = `cd "${pane.path}" && tar -cf "${archivePath}" ${files}`;
                }

                await execPromise(cmd);
                alert('Files compressed successfully!');
                this.refresh();
            } catch (err) {
                alert('Failed to compress: ' + err.message);
            }
        }
    );
}

async extractArchive(paneIndex, extractHere) {
    const archiveNotice = document.getElementById(`archive-notice-${paneIndex}`);
    const archivePath = archiveNotice.dataset.archive;
    
    if (!archivePath) return;

    let targetPath;
    if (extractHere) {
        const archiveName = path.basename(archivePath, path.extname(archivePath));
        targetPath = path.join(path.dirname(archivePath), archiveName);
        
        if (!fs.existsSync(targetPath)) {
            fs.mkdirSync(targetPath, { recursive: true });
        }
    } else {
        const input = document.createElement('input');
        input.type = 'file';
        input.setAttribute('nwdirectory', '');
        input.setAttribute('nwdirectorydesc', 'Select extraction directory');
        
        input.onchange = async () => {
            targetPath = input.value;
            await this.performExtraction(archivePath, targetPath);
        };
        
        input.click();
        return;
    }

    await this.performExtraction(archivePath, targetPath);
}

async performExtraction(archivePath, targetPath) {
    try {
        let cmd;
        if (archivePath.endsWith('.zip')) {
            cmd = `unzip -o "${archivePath}" -d "${targetPath}"`;
        } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
            cmd = `tar -xzf "${archivePath}" -C "${targetPath}"`;
        } else if (archivePath.endsWith('.tar')) {
            cmd = `tar -xf "${archivePath}" -C "${targetPath}"`;
        } else if (archivePath.endsWith('.rar')) {
            cmd = `unrar x "${archivePath}" "${targetPath}"`;
        }

        await execPromise(cmd);
        alert('Archive extracted successfully!');
        this.refresh();
    } catch (err) {
        alert('Failed to extract archive: ' + err.message);
    }
}

async showProperties(file) {
    try {
        const stats = fs.lstatSync(file.path);
        const type = file.isDirectory ? 'Directory' : 'File';
        const size = this.formatSize(stats.size);
        const modified = stats.mtime.toLocaleString();
        const created = stats.birthtime.toLocaleString();
        const permissions = (stats.mode & parseInt('777', 8)).toString(8);
        
        let owner = 'Unknown';
        let group = 'Unknown';
        
        try {
            const { stdout } = await execPromise(`stat -c '%U:%G' "${file.path}"`);
            [owner, group] = stdout.trim().split(':');
        } catch (err) {}

        this.showModal(
            'Properties',
            `<div style="font-size:13px;line-height:1.8;">
                <strong>Name:</strong> ${file.name}<br>
                <strong>Type:</strong> ${type}<br>
                <strong>Size:</strong> ${size}<br>
                <strong>Owner:</strong> ${owner}:${group}<br>
                <strong>Permissions:</strong> ${permissions}<br>
                <strong>Created:</strong> ${created}<br>
                <strong>Modified:</strong> ${modified}<br>
                <strong>Path:</strong> ${file.path}
            </div>`,
            null
        );
    } catch (err) {
        alert('Failed to get properties: ' + err.message);
    }
}

async unmountDevice(deviceName, mountPath) {
    const confirmed = confirm(`Unmount ${path.basename(mountPath)}?`);
    if (!confirmed) return;

    try {
        await execPromise(`udisksctl unmount -b /dev/${deviceName}`);
        alert('Device unmounted successfully');
        this.loadDevices();
    } catch (err) {
        alert('Failed to unmount device: ' + err.message);
    }
}

async showDeviceProperties(mountPath, deviceName) {
    try {
        const { stdout } = await execPromise(`df -h "${mountPath}"`);
        const lines = stdout.trim().split('\n');
        const info = lines[1].split(/\s+/);

        this.showModal(
            'Device Properties',
            `<div style="font-size:13px;line-height:1.8;">
                <strong>Device:</strong> /dev/${deviceName}<br>
                <strong>Mount Point:</strong> ${mountPath}<br>
                <strong>Total Size:</strong> ${info[1]}<br>
                <strong>Used:</strong> ${info[2]}<br>
                <strong>Available:</strong> ${info[3]}<br>
                <strong>Usage:</strong> ${info[4]}
            </div>`,
            null
        );
    } catch (err) {
        alert('Failed to get device properties: ' + err.message);
    }
}

// CUSTOM PLACES
addToCustomPlaces(placePath) {
    const name = path.basename(placePath);
    if (!this.customPlaces.find(p => p.path === placePath)) {
        this.customPlaces.push({ name, path: placePath });
        this.saveCustomPlaces();
        this.renderCustomPlaces();
    }
}

renderCustomPlaces() {
    const container = document.getElementById('custom-places');
    container.innerHTML = this.customPlaces.map(place => 
        `<div class="sidebar-item" data-custom-path="${place.path}">📍 ${place.name}</div>`
    ).join('');

    container.querySelectorAll('.sidebar-item').forEach(item => {
        item.addEventListener('click', () => {
            const tab = this.getActiveTab();
            this.loadDirectory(item.dataset.customPath, tab.activePaneIndex);
        });

        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const menu = document.createElement('div');
            menu.className = 'context-menu';
            menu.innerHTML = `
                <div class="context-menu-item">🗑️ Remove</div>
            `;
            menu.querySelector('.context-menu-item').addEventListener('click', () => {
                this.customPlaces = this.customPlaces.filter(p => p.path !== item.dataset.customPath);
                this.saveCustomPlaces();
                this.renderCustomPlaces();
                this.hideContextMenu();
            });
            
            document.body.appendChild(menu);
            const rect = menu.getBoundingClientRect();
            menu.style.left = Math.min(e.pageX, window.innerWidth - rect.width - 10) + 'px';
            menu.style.top = Math.min(e.pageY, window.innerHeight - rect.height - 10) + 'px';
            this.contextMenu = menu;
        });
    });
}

// TEXT EDITOR
openInTextEditor(file) {
    const tab = this.getActiveTab();
    tab.isEditing = true;
    tab.editingFile = file;
    this.renderContent();
}

renderTextEditor(container, tab) {
    container.innerHTML = `
        <div class="text-editor">
            <div class="text-editor-toolbar">
                <button class="btn" onclick="fileManager.saveTextFile()">💾 Save</button>
                <button class="btn" onclick="fileManager.closeTextEditor()">✖ Close</button>
                <span style="margin-left: auto; font-size: 13px;">${tab.editingFile.name}</span>
            </div>
            <textarea class="text-editor-content" id="text-editor-content"></textarea>
        </div>
    `;

    try {
        const content = fs.readFileSync(tab.editingFile.path, 'utf8');
        document.getElementById('text-editor-content').value = content;
    } catch (err) {
        alert('Failed to open file: ' + err.message);
        this.closeTextEditor();
    }
}

saveTextFile() {
    const tab = this.getActiveTab();
    if (!tab.editingFile) return;

    const content = document.getElementById('text-editor-content').value;
    try {
        fs.writeFileSync(tab.editingFile.path, content, 'utf8');
        alert('File saved successfully!');
    } catch (err) {
        alert('Failed to save file: ' + err.message);
    }
}

closeTextEditor() {
    const tab = this.getActiveTab();
    if (!tab) return;
    
    // Store the path before clearing editing state
    const returnPath = tab.panes[tab.activePaneIndex].path;
    
    tab.isEditing = false;
    tab.editingFile = null;
    
    // Reload the directory to show files again
    this.loadDirectory(returnPath, tab.activePaneIndex);
}

// PERSISTENCE
loadTags() {
    try {
        const tagsPath = path.join(os.homedir(), '.filemanager-tags.json');
        if (fs.existsSync(tagsPath)) {
            this.fileTags = JSON.parse(fs.readFileSync(tagsPath, 'utf8'));
        }
    } catch (err) {
        console.error('Failed to load tags:', err);
    }
}

saveTags() {
    try {
        const tagsPath = path.join(os.homedir(), '.filemanager-tags.json');
        fs.writeFileSync(tagsPath, JSON.stringify(this.fileTags, null, 2));
    } catch (err) {
        console.error('Failed to save tags:', err);
    }
}

loadDefaultApps() {
    try {
        const appsPath = path.join(os.homedir(), '.filemanager-apps.json');
        if (fs.existsSync(appsPath)) {
            this.defaultApps = JSON.parse(fs.readFileSync(appsPath, 'utf8'));
        }
    } catch (err) {
        console.error('Failed to load default apps:', err);
    }
}

saveDefaultApps() {
    try {
        const appsPath = path.join(os.homedir(), '.filemanager-apps.json');
        fs.writeFileSync(appsPath, JSON.stringify(this.defaultApps, null, 2));
    } catch (err) {
        console.error('Failed to save default apps:', err);
    }
}

loadCustomPlaces() {
    try {
        const placesPath = path.join(os.homedir(), '.filemanager-places.json');
        if (fs.existsSync(placesPath)) {
            this.customPlaces = JSON.parse(fs.readFileSync(placesPath, 'utf8'));
            this.renderCustomPlaces();
        }
    } catch (err) {
        console.error('Failed to load custom places:', err);
    }
}

saveCustomPlaces() {
    try {
        const placesPath = path.join(os.homedir(), '.filemanager-places.json');
        fs.writeFileSync(placesPath, JSON.stringify(this.customPlaces, null, 2));
    } catch (err) {
        console.error('Failed to save custom places:', err);
    }
}

showModal(title, bodyHtml, onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-title">${title}</div>
            <div class="modal-body">${bodyHtml}</div>
            <div class="modal-actions">
                <button class="btn" id="modal-cancel">Cancel</button>
                ${onConfirm ? '<button class="btn btn-primary" id="modal-ok">OK</button>' : ''}
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const close = () => modal.remove();

    document.getElementById('modal-cancel').addEventListener('click', close);
    if (onConfirm) {
        document.getElementById('modal-ok').addEventListener('click', () => {
            onConfirm();
            close();
        });
    }

    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
}

} // End of FileManager class

// Initialize the file manager when DOM is ready
const fileManager = new FileManager();