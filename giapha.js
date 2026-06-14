let familyData = null;
        let selectedNodeId = null;

        // Cấu hình các biến phục vụ tính năng Zoom và Kéo thả (Pan)
        let scale = 1;
        let panX = 0;
        let panY = 0;
        let isDragging = false;
        let startX = 0;
        let startY = 0;
        let pinchStartDistance = null;
        let initialScaleForPinch = null;
        let prePrintState = null;

        function init() {
            const savedData = localStorage.getItem('family_tree_data');
            if (savedData) {
                familyData = JSON.parse(savedData);
                renderTree();
                selectMember(familyData.id);
            } else {
                // Try to auto-load cay_gia_pha.json located in the same folder as this HTML file.
                // If the fetch fails (CORS / file:// restrictions), fall back to showing the root actions.
                fetch('cay_gia_pha.json')
                    .then(resp => {
                        if (!resp.ok) throw new Error('No local JSON file');
                        return resp.text();
                    })
                    .then(text => {
                        try {
                            const parsed = JSON.parse(text);
                            if (parsed && parsed.id && parsed.name) {
                                familyData = parsed;
                                selectedNodeId = familyData.id;
                                saveToStorage();
                                renderTree();
                                selectMember(familyData.id);
                            } else {
                                document.getElementById('root-actions').style.display = 'block';
                            }
                        } catch (err) {
                            console.warn('Failed to parse cay_gia_pha.json:', err);
                            document.getElementById('root-actions').style.display = 'block';
                        }
                    })
                    .catch(err => {
                        console.info('No cay_gia_pha.json auto-loaded:', err);
                        document.getElementById('root-actions').style.display = 'block';
                    });
            }
            // Auto-hide left sidebar on initial page load
            document.body.classList.add('sidebar-collapsed');
            updateSidebarToggleButton();
            initPanZoomListeners(); // Kích hoạt bộ lắng nghe sự kiện kéo thả chuột
        }

        function toggleSidebar() {
            document.body.classList.toggle('sidebar-collapsed');
            updateSidebarToggleButton();
        }

        function updateSidebarToggleButton() {
            const btn = document.getElementById('sidebar-toggle-btn');
            if (!btn) return;

            const isCollapsed = document.body.classList.contains('sidebar-collapsed');
            btn.innerText = isCollapsed ? '☰' : '✕';
            btn.title = isCollapsed ? 'Hiện menu trái' : 'Ẩn menu trái';
        }

        function generateId() {
            return '_' + Math.random().toString(36).substr(2, 9);
        }

        // Tìm kiếm nâng cao cấu trúc cây
        function findNodeById(root, id) {
            if (!root) return null;
            if (root.id === id) return { type: 'member', node: root, parent: null };
            
            if (root.spouses) {
                for (let s of root.spouses) {
                    if (s.id === id) return { type: 'spouse', node: s, mainMember: root };
                }
            }
            
            if (root.children) {
                for (let child of root.children) {
                    if (child.id === id) return { type: 'member', node: child, parent: root };
                    let found = findNodeById(child, id);
                    if (found) return found;
                }
            }
            return null;
        }

        function saveToStorage() {
            localStorage.setItem('family_tree_data', JSON.stringify(familyData));
        }

        function countPersons(root) {
            if (!root) return 0;
            const seen = new Set();
            function traverse(node) {
                if (!node) return;
                if (node.id) seen.add(node.id);
                if (node.spouses && node.spouses.length) {
                    node.spouses.forEach(s => { if (s && s.id) seen.add(s.id); });
                }
                if (node.children && node.children.length) {
                    node.children.forEach(c => traverse(c));
                }
            }
            traverse(root);
            return seen.size;
        }

        function updateTotalCount() {
            const el = document.getElementById('total-count');
            const count = familyData ? countPersons(familyData) : 0;
            if (el) el.innerText = `Tổng thành viên: ${count}`;
        }

        // QUẢN LÝ TÍNH NĂNG ZOOM & PAN (KÉO THẢ)
        function initPanZoomListeners() {
            const container = document.getElementById('tree-container');
            
            // Bắt đầu nhấp chuột để kéo
            container.addEventListener('mousedown', (e) => {
                if (document.body.classList.contains('print-mode')) return;
                // Nếu click vào các thẻ thành viên hoặc nút bấm thì không kích hoạt kéo màn hình
                if (e.target.closest('.card') || e.target.closest('.zoom-controls')) return;
                isDragging = true;
                startX = e.clientX - panX;
                startY = e.clientY - panY;
            });

            // Di chuyển chuột khi đang giữ
            window.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                panX = e.clientX - startX;
                panY = e.clientY - startY;
                applyTransform();
            });

            // Thả chuột
            window.addEventListener('mouseup', () => {
                isDragging = false;
            });

            // Lăn bánh xe chuột để Zoom In / Zoom Out
            container.addEventListener('wheel', (e) => {
                if (document.body.classList.contains('print-mode')) return;
                e.preventDefault();
                const zoomStep = 0.05;
                if (e.deltaY < 0) {
                    scale = Math.min(scale + zoomStep, 3); // Giới hạn tối đa phóng to là 3 lần
                } else {
                    scale = Math.max(scale - zoomStep, 0.15); // Giới hạn tối thiểu thu nhỏ là 0.15 lần
                }
                applyTransform();
            }, { passive: false });

            // Touch events: support one-finger pan and two-finger pinch-to-zoom
            function getTouchDistance(t1, t2) {
                const dx = t2.clientX - t1.clientX;
                const dy = t2.clientY - t1.clientY;
                return Math.hypot(dx, dy);
            }

            container.addEventListener('touchstart', (e) => {
                if (document.body.classList.contains('print-mode')) return;
                if (!e.touches || e.touches.length === 0) return;

                // If the touch is on an interactive element (buttons, links, inputs, sidebar toggle, zoom controls, cards, or sidebar), don't start pan
                const target = e.target;
                if (target && target.closest) {
                    const interactive = target.closest('button, a, input, select, textarea, .sidebar-toggle, .sidebar, .zoom-controls, .card');
                    if (interactive) return;
                }

                if (e.touches.length === 1) {
                    isDragging = true;
                    startX = e.touches[0].clientX - panX;
                    startY = e.touches[0].clientY - panY;
                    e.preventDefault();
                } else if (e.touches.length === 2) {
                    // Begin pinch
                    pinchStartDistance = getTouchDistance(e.touches[0], e.touches[1]);
                    initialScaleForPinch = scale;
                    e.preventDefault();
                }
            }, { passive: false });

            container.addEventListener('touchmove', (e) => {
                if (document.body.classList.contains('print-mode')) return;
                if (!e.touches || e.touches.length === 0) return;

                if (e.touches.length === 1 && isDragging) {
                    panX = e.touches[0].clientX - startX;
                    panY = e.touches[0].clientY - startY;
                    applyTransform();
                    e.preventDefault();
                } else if (e.touches.length === 2 && pinchStartDistance) {
                    const newDist = getTouchDistance(e.touches[0], e.touches[1]);
                    const ratio = newDist / pinchStartDistance;
                    scale = Math.max(0.15, Math.min(initialScaleForPinch * ratio, 3));
                    applyTransform();
                    e.preventDefault();
                }
            }, { passive: false });

            container.addEventListener('touchend', (e) => {
                // When fingers lifted, reset states appropriately
                if (!e.touches || e.touches.length === 0) {
                    isDragging = false;
                    pinchStartDistance = null;
                    initialScaleForPinch = null;
                } else if (e.touches.length === 1) {
                    // If one finger remains after pinch, allow continued pan
                    isDragging = true;
                    startX = e.touches[0].clientX - panX;
                    startY = e.touches[0].clientY - panY;
                    pinchStartDistance = null;
                    initialScaleForPinch = null;
                }
            });
        }

        function applyTransform() {
            const root = document.getElementById('tree-root');
            if (root) {
                // Sử dụng thuộc tính translate và scale của CSS để di chuyển và phóng to đồ họa
                root.style.transform = `translate(calc(-50% + ${panX}px), ${panY}px) scale(${scale})`;
            }
        }

        function zoomIn() {
            if (document.body.classList.contains('print-mode')) return;
            scale = Math.min(scale + 0.15, 3);
            applyTransform();
        }

        function zoomOut() {
            if (document.body.classList.contains('print-mode')) return;
            scale = Math.max(scale - 0.15, 0.15);
            applyTransform();
        }

        function resetZoom() {
            if (document.body.classList.contains('print-mode')) return;
            scale = 1;
            panX = 0;
            panY = 0;
            applyTransform();
        }

        function fitTreeToA0Viewport() {
            const container = document.getElementById('tree-container');
            const root = document.getElementById('tree-root');
            if (!container || !root) return;

            root.style.transform = 'translate(0px, 0px) scale(1)';

            const rootBounds = root.getBoundingClientRect();
            const containerBounds = container.getBoundingClientRect();

            if (!rootBounds.width || !rootBounds.height) return;

            const margin = 28;
            const availableWidth = Math.max(containerBounds.width - margin * 2, 100);
            const availableHeight = Math.max(containerBounds.height - margin * 2, 100);

            const fitScale = Math.min(
                availableWidth / rootBounds.width,
                availableHeight / rootBounds.height,
                1.5
            );

            const centeredX = (containerBounds.width - rootBounds.width * fitScale) / 2;
            const topY = margin;

            root.style.transform = `translate(${centeredX}px, ${topY}px) scale(${fitScale})`;
        }

        function restoreAfterPrint() {
            if (!prePrintState) return;

            document.body.classList.remove('print-mode');
            scale = prePrintState.scale;
            panX = prePrintState.panX;
            panY = prePrintState.panY;

            if (prePrintState.sidebarCollapsed) {
                document.body.classList.add('sidebar-collapsed');
            } else {
                document.body.classList.remove('sidebar-collapsed');
            }

            applyTransform();
            updateSidebarToggleButton();
            prePrintState = null;
        }

        function prepareAndPrintA0() {
            if (!familyData) {
                alert('Chưa có dữ liệu gia phả để in.');
                return;
            }

            prePrintState = {
                scale,
                panX,
                panY,
                sidebarCollapsed: document.body.classList.contains('sidebar-collapsed')
            };

            document.body.classList.remove('sidebar-collapsed');
            updateSidebarToggleButton();
            document.body.classList.add('print-mode');

            fitTreeToA0Viewport();
            setTimeout(() => {
                window.print();
            }, 120);
        }

        // CHỨC NĂNG XÓA THÀNH VIÊN
        function deleteMember() {
            if (!selectedNodeId) return;
            
            const res = findNodeById(familyData, selectedNodeId);
            if (!res) return;

            let confirmMsg = `Bạn có chắc chắn muốn xóa "${res.node.name}" không?`;
            
            if (res.type === 'member') {
                if (!res.parent) {
                    confirmMsg = `⚠️ Chú ý: Người này là Thành Viên Gốc. Xóa đi đồng nghĩa xóa TOÀN BỘ CÂY GIA PHẢ! Bạn vẫn muốn xóa?`;
                } else if (res.node.children && res.node.children.length > 0) {
                    confirmMsg = `⚠️ Cảnh báo quan trọng: Xóa "${res.node.name}" sẽ ĐỒNG THỜI XÓA SẠCH tất cả con, cháu, chắt... thuộc nhánh của người này! Hành động không thể khôi phục. Bạn đồng ý?`;
                }
            }

            if (confirm(confirmMsg)) {
                if (res.type === 'member' && !res.parent) {
                    // Xóa gốc (Xóa hết)
                    familyData = null;
                    selectedNodeId = null;
                } else if (res.type === 'spouse') {
                    // Xóa vợ hoặc chồng phối ngẫu
                    res.mainMember.spouses = res.mainMember.spouses.filter(s => s.id !== selectedNodeId);
                    
                    // Kiểm tra và dọn dẹp liên kết Cha/Mẹ của con cháu liên quan đến người vừa xóa
                    if (res.mainMember.children) {
                        res.mainMember.children.forEach(child => {
                            if (child.spouseParentId === selectedNodeId) {
                                child.spouseParentId = ""; // Trả về trạng thái không rõ mẹ/cha cụ thể
                            }
                        });
                    }
                    selectedNodeId = res.mainMember.id; // Chuyển vùng chọn về người phối ngẫu chính
                } else if (res.type === 'member' && res.parent) {
                    // Xóa con (Xóa toàn bộ nhánh con cháu bên dưới)
                    res.parent.children = res.parent.children.filter(c => c.id !== selectedNodeId);
                    selectedNodeId = res.parent.id; // Chuyển vùng chọn về cha mẹ của người vừa xóa
                }

                saveToStorage();
                hideForm();
                renderTree();
            }
        }

        // FORM THAO TÁC THÊM MỚI
        function showAddForm(type) {
            document.getElementById('form-container').style.display = 'block';
            document.getElementById('form-type').value = type;
            document.getElementById('member-form').reset();
            
            document.getElementById('order-group').style.display = 'none';
            document.getElementById('spouse-parent-group').style.display = 'none';

            const res = findNodeById(familyData, selectedNodeId);

            if (type === 'root') {
                document.getElementById('form-title').innerText = "Thêm Thành Viên Gốc";
            } else if (type === 'spouse') {
                document.getElementById('form-title').innerText = "Thêm Vợ / Chồng";
                const current = res.type === 'member' ? res.node : res.mainMember;
                document.getElementById('input-gender').value = current.gender === 'Nam' ? 'Nữ' : 'Nam';
            } else if (type === 'child') {
                document.getElementById('form-title').innerText = "Thêm Con";
                document.getElementById('order-group').style.display = 'flex';
                
                const bloodlineNode = res.type === 'member' ? res.node : res.mainMember;
                document.getElementById('input-order').value = (bloodlineNode.children ? bloodlineNode.children.length : 0) + 1;
                
                if (bloodlineNode.spouses && bloodlineNode.spouses.length > 0) {
                    document.getElementById('spouse-parent-group').style.display = 'flex';
                    const selectSpouse = document.getElementById('input-spouse-parent');
                    selectSpouse.innerHTML = '<option value="">-- Không chọn / Không rõ --</option>';
                    bloodlineNode.spouses.forEach(s => {
                        let role = s.gender === 'Nữ' ? 'Vợ' : 'Chồng';
                        let selectedAttr = (res.type === 'spouse' && res.node.id === s.id) ? 'selected' : '';
                        selectSpouse.innerHTML += `<option value="${s.id}" ${selectedAttr}>${s.name} (${role})</option>`;
                    });
                }
            }
        }

        // FORM THAO TÁC SỬA THÔNG TIN
        function showEditForm() {
            const res = findNodeById(familyData, selectedNodeId);
            if (!res) return;
            
            document.getElementById('form-container').style.display = 'block';
            document.getElementById('form-type').value = 'edit';
            document.getElementById('form-title').innerText = "Sửa Thông Tin";
            
            const node = res.node;
            document.getElementById('input-name').value = node.name;
            document.getElementById('input-gender').value = node.gender;
            document.getElementById('input-birth').value = node.birthYear || '';
            document.getElementById('input-death').value = (node.deathYear === 'Đang sống') ? '' : node.deathYear;
            
            if (res.type === 'member' && res.parent) {
                document.getElementById('order-group').style.display = 'flex';
                document.getElementById('input-order').value = node.birthOrder || 1;
                
                if (res.parent.spouses && res.parent.spouses.length > 0) {
                    document.getElementById('spouse-parent-group').style.display = 'flex';
                    const selectSpouse = document.getElementById('input-spouse-parent');
                    selectSpouse.innerHTML = '<option value="">-- Không chọn / Không rõ --</option>';
                    res.parent.spouses.forEach(s => {
                        let role = s.gender === 'Nữ' ? 'Vợ' : 'Chồng';
                        let selectedAttr = node.spouseParentId === s.id ? 'selected' : '';
                        selectSpouse.innerHTML += `<option value="${s.id}" ${selectedAttr}>${s.name} (${role})</option>`;
                    });
                } else {
                    document.getElementById('spouse-parent-group').style.display = 'none';
                }
            } else {
                document.getElementById('order-group').style.display = 'none';
                document.getElementById('spouse-parent-group').style.display = 'none';
            }
        }

        function hideForm() {
            document.getElementById('form-container').style.display = 'none';
        }

        function handleFormSubmit(e) {
            e.preventDefault();
            
            const type = document.getElementById('form-type').value;
            const name = document.getElementById('input-name').value;
            const gender = document.getElementById('input-gender').value;
            const birth = document.getElementById('input-birth').value || "";
            let death = document.getElementById('input-death').value || "Đang sống";
            const order = parseInt(document.getElementById('input-order').value) || 1;
            const spouseParentId = document.getElementById('input-spouse-parent').value || "";

            if (type === 'edit') {
                const res = findNodeById(familyData, selectedNodeId);
                if (res) {
                    res.node.name = name;
                    res.node.gender = gender;
                    res.node.birthYear = birth;
                    res.node.deathYear = death;
                    
                    if (res.type === 'member') {
                        res.node.birthOrder = order;
                        res.node.spouseParentId = spouseParentId;
                        if (res.parent) {
                            res.parent.children.sort((a, b) => (a.birthOrder || 1) - (b.birthOrder || 1));
                        }
                    }
                }
            } else if (type === 'root') {
                familyData = {
                    id: generateId(), name: name, gender: gender, birthYear: birth, deathYear: death,
                    birthOrder: 1, spouses: [], children: []
                };
                selectedNodeId = familyData.id;
            } else if (type === 'spouse') {
                const res = findNodeById(familyData, selectedNodeId);
                const target = res.type === 'member' ? res.node : res.mainMember;
                if (target) {
                    target.spouses.push({
                        id: generateId(), name: name, gender: gender, birthYear: birth, deathYear: death
                    });
                }
            } else if (type === 'child') {
                const res = findNodeById(familyData, selectedNodeId);
                const target = res.type === 'member' ? res.node : res.mainMember;
                if (target) {
                    const newChild = {
                        id: generateId(), name: name, gender: gender, birthYear: birth, deathYear: death,
                        birthOrder: order, spouseParentId: spouseParentId, spouses: [], children: []
                    };
                    if (!target.children) target.children = [];
                    target.children.push(newChild);
                    target.children.sort((a, b) => (a.birthOrder || 1) - (b.birthOrder || 1));
                }
            }

            saveToStorage();
            hideForm();
            renderTree();
            selectMember(selectedNodeId);
        }

        function selectMember(id) {
            selectedNodeId = id;
            
            document.querySelectorAll('.card').forEach(el => el.classList.remove('card-selected'));
            const element = document.getElementById('card-' + id);
            if (element) element.classList.add('card-selected');

            const res = findNodeById(familyData, id);
            if (res) {
                const node = res.node;
                document.getElementById('root-actions').style.display = 'none';
                document.getElementById('member-actions').style.display = 'block';
                
                let extraInfo = '';
                if (res.type === 'spouse') {
                    extraInfo = `<br>Vị trí: Bạn đời của ${res.mainMember.name}`;
                } else {
                    extraInfo = `<br>Con thứ: ${node.birthOrder || 1}`;
                    if (node.spouseParentId && res.parent) {
                        let sp = res.parent.spouses.find(s => s.id === node.spouseParentId);
                        if (sp) {
                            let label = res.parent.gender === 'Nam' ? 'Mẹ' : 'Cha';
                            extraInfo += `<br>${label}: ${sp.name}`;
                        }
                    }
                }

                document.getElementById('selected-info').innerHTML = `
                    <strong>${node.name}</strong><br>
                    Giới tính: ${node.gender}<br>
                    Năm sinh: ${node.birthYear || 'Chưa rõ'}<br>
                    Năm mất: ${node.deathYear}${extraInfo}
                `;
            }
        }

        // Tạo cây đồ họa (Đệ quy cấu trúc)
        // Tạo cây đồ họa (Đệ quy cấu trúc)
        function createTreeHTML(node, parentNode = null) {
            if (!node) return '';

            let html = `<li>`;
            html += `<div class="member-block" id="block-${node.id}">`;
            
            let yearsStr = (node.birthYear || '?') + ' - ' + (node.deathYear || 'Đang sống');
            if(!node.birthYear && node.deathYear === 'Đang sống') yearsStr = 'Chưa rõ năm sinh';

            let parentSpouseText = '';
            if (node.spouseParentId && parentNode && parentNode.spouses) {
                let sp = parentNode.spouses.find(s => s.id === node.spouseParentId);
                if (sp) {
                    let relationLabel = parentNode.gender === 'Nam' ? 'Mẹ' : 'Cha';
                    parentSpouseText = `<div class="parent-spouse">(${relationLabel}: ${sp.name})</div>`;
                }
            }

            const genderClassMain = node.gender === 'Nam' ? 'gender-nam' : 'gender-nu';
            const selectedClassMain = selectedNodeId === node.id ? 'card-selected' : '';
            
            // 1. Tạo HTML cho thành viên chính
            let mainMemberHTML = `
                <div class="card ${genderClassMain} ${selectedClassMain}" id="card-${node.id}" onclick="selectMember('${node.id}'); event.stopPropagation();">
                    <div class="name">${node.name}</div>
                    <div class="years">${yearsStr}</div>
                    ${parentSpouseText}
                    <div class="order">Con thứ ${node.birthOrder || 1}</div>
                </div>
            `;

            let firstSpouseHTML = '';
            let otherSpousesHTML = '';

            if (node.spouses && node.spouses.length > 0) {
                // 2. Xử lý người vợ/chồng đầu tiên (Hiển thị bên trái thành viên chính)
                const firstSpouse = node.spouses[0];
                const fsGenderClass = firstSpouse.gender === 'Nam' ? 'gender-nam' : 'gender-nu';
                const fsSelectedClass = selectedNodeId === firstSpouse.id ? 'card-selected' : '';
                let fsYearsStr = (firstSpouse.birthYear || '?') + ' - ' + (firstSpouse.deathYear || 'Đang sống');
                if(!firstSpouse.birthYear && firstSpouse.deathYear === 'Đang sống') fsYearsStr = 'Chưa rõ năm sinh';

                // Lưu ý dấu "+" nằm ở bên phải của người vợ/chồng đầu tiên này
                firstSpouseHTML = `
                    <div class="spouse-container">
                        <div class="card ${fsGenderClass} ${fsSelectedClass}" id="card-${firstSpouse.id}" onclick="selectMember('${firstSpouse.id}'); event.stopPropagation();">
                            <div class="name">${firstSpouse.name}</div>
                            <div class="years">${fsYearsStr}</div>
                            <div class="order" style="background:rgba(0,0,0,0.05)">Bạn đời</div>
                        </div>
                        <div class="spouse-sign">+</div>
                    </div>
                `;

                // 3. Xử lý các người vợ/chồng tiếp theo từ người thứ 2 trở đi (Hiển thị bên phải)
                if (node.spouses.length > 1) {
                    otherSpousesHTML += `<div class="spouse-container">`;
                    for (let i = 1; i < node.spouses.length; i++) {
                        const spouse = node.spouses[i];
                        const genderClassSpouse = spouse.gender === 'Nam' ? 'gender-nam' : 'gender-nu';
                        const selectedClassSpouse = selectedNodeId === spouse.id ? 'card-selected' : '';
                        let sYearsStr = (spouse.birthYear || '?') + ' - ' + (spouse.deathYear || 'Đang sống');
                        if(!spouse.birthYear && spouse.deathYear === 'Đang sống') sYearsStr = 'Chưa rõ năm sinh';

                        // Dấu "+" nằm ở bên trái của các người vợ/chồng tiếp theo
                        otherSpousesHTML += `
                            <div class="spouse-sign">+</div>
                            <div class="card ${genderClassSpouse} ${selectedClassSpouse}" id="card-${spouse.id}" onclick="selectMember('${spouse.id}'); event.stopPropagation();">
                                <div class="name">${spouse.name}</div>
                                <div class="years">${sYearsStr}</div>
                                <div class="order" style="background:rgba(0,0,0,0.05)">Bạn đời</div>
                            </div>
                        `;
                    }
                    otherSpousesHTML += `</div>`;
                }
            }

            // 4. Ghép các khối lại theo đúng thứ tự: Trái -> Giữa -> Phải
            html += firstSpouseHTML + mainMemberHTML + otherSpousesHTML;

            html += `</div>`; // Đóng .member-block

            // Khối con cái (giữ nguyên)
            if (node.children && node.children.length > 0) {
                html += `<ul>`;
                node.children.forEach(child => {
                    html += createTreeHTML(child, node);
                });
                html += `</ul>`;
            }

            html += `</li>`;
            return html;
        }

        function renderTree() {
            const container = document.getElementById('tree-root');
            if (!familyData) {
                container.innerHTML = '';
                document.getElementById('root-actions').style.display = 'block';
                document.getElementById('member-actions').style.display = 'none';
                updateTotalCount();
                return;
            }
            container.innerHTML = `<ul>${createTreeHTML(familyData)}</ul>`;
            applyTransform(); // Giữ nguyên tọa độ dịch chuyển và tỉ lệ thu phóng sau khi render lại dữ liệu
            if (selectedNodeId) selectMember(selectedNodeId);
            updateTotalCount();
        }

        // XUẤT FILE JSON
        function exportJSON() {
            if (!familyData) {
                alert("Không có dữ liệu để xuất file!");
                return;
            }
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(familyData, null, 2));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", "cay_gia_pha.json");
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        }

        // NHẬP FILE JSON
        function triggerImportJSON() {
            document.getElementById('import-file').click();
        }

        function importJSON(event) {
            const file = event.target.files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const parsedData = JSON.parse(e.target.result);
                    if (parsedData && parsedData.name && parsedData.id) {
                        familyData = parsedData;
                        selectedNodeId = familyData.id;
                        saveToStorage();
                        resetZoom(); // Reset lại màn hình cho người dùng dễ nhìn cấu trúc cây mới nhập
                        renderTree();
                        alert("Nhập dữ liệu gia phả thành công!");
                    } else {
                        alert("Cấu trúc tệp JSON không đúng định dạng gia phả.");
                    }
                } catch (err) {
                    alert("Lỗi khi đọc file JSON: " + err.message);
                }
            };
            reader.readAsText(file);
            event.target.value = ''; 
        }

        function clearTree() {
            if (confirm("Bạn có chắc chắn muốn xóa sạch cây gia phả hiện tại không?")) {
                familyData = null;
                selectedNodeId = null;
                localStorage.removeItem('family_tree_data');
                hideForm();
                resetZoom();
                renderTree();
            }
        }

        window.addEventListener('afterprint', restoreAfterPrint);
        window.onload = init;