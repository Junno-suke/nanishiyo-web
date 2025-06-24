import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot, query, where, addDoc, doc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

let isPopupOpen = false;
let scrollbarWidth = 0;
let currentEditingTaskId = null;
let tempTaskData = null; 

const firebaseConfig = {
    apiKey: "AIzaSyBPNYOsSngicuIqjbL00CikbDnFDLAqpIw",
    authDomain: "my-program-nanishi-yo.firebaseapp.com",
    projectId: "my-program-nanishi-yo",
    storageBucket: "my-program-nanishi-yo.firebasestorage.app",
    messagingSenderId: "757333296882",
    appId: "1:757333296882:web:f50c5c857863dbd05af26b",
    measurementId: "G-ZSPCBH7GM2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentUserId = null;
let tasks = [];
let templates = [];
let activeTask = null;
let taskCheckTimeout = null;
let progressBarInterval = null;

const colors = [
    { value: '#FFFFFF', textColor: '#000000' },
    { value: '#FF3B30', textColor: '#FFFFFF' }, // Red
    { value: '#FF9500', textColor: '#FFFFFF' }, // Orange
    { value: '#FFCC00', textColor: '#000000' }, // Yellow
    { value: '#34C759', textColor: '#FFFFFF' }, // Green
    { value: '#007AFF', textColor: '#FFFFFF' }, // Blue
    { value: '#5856D6', textColor: '#FFFFFF' }, // Indigo
    { value: '#AF52DE', textColor: '#FFFFFF' }, // Purple
    { value: '#A2845E', textColor: '#FFFFFF' }, // Brown
    { value: '#8E8E93', textColor: '#FFFFFF' }, // Gray
    { value: '#000000', textColor: '#FFFFFF' },
];

document.addEventListener('DOMContentLoaded', () => {
    // 全要素の取得
    const settingsPanel = document.getElementById('settingsPanel');
    const fullScreenOverlay = document.getElementById('fullScreenOverlay');
    const settingsButton = document.getElementById('settingsButton');
    const backButton = document.getElementById('backButton');
    const userIdDisplay = document.getElementById('userIdDisplay');
    const calendarGrid = document.getElementById('calendarGrid');
    const noTasksMessage = document.getElementById('noTasksMessage');
    const notificationBanner = document.getElementById('notificationBanner');
    
    // ポップアップ要素
    const quickAddTaskPopup = document.getElementById('quickAddTaskPopup');
    const calendarTaskPopup = document.getElementById('calendarTaskPopup');
    const saveTemplatePopup = document.getElementById('saveTemplatePopup');
    const overlapDialog = document.getElementById('overlapDialog');

    // テンプレート関連
    const templateActionsButton = document.getElementById('templateActionsButton');
    const templateDropdownMenu = document.getElementById('templateDropdownMenu');
    const saveScheduleAsTemplateButton = document.getElementById('saveScheduleAsTemplateButton');
    const templateListContainer = document.getElementById('templateList');
    const templateNameInput = document.getElementById('templateNameInput');
    const saveTemplateConfirmButton = document.getElementById('saveTemplateConfirmButton');
    const saveTemplateCancelButton = document.getElementById('saveTemplateCancelButton');

    // タスク追加ポップアップの要素
    const quickAddTaskNameInput = document.getElementById('quickAddTaskName');
    const quickAddStartTimeInput = document.getElementById('quickAddStartTime');
    const quickAddEndTimeInput = document.getElementById('quickAddEndTime');
    const quickAddDayCheckboxes = document.getElementById('quickAddDayCheckboxes');
    const quickAddTaskSaveButton = document.getElementById('quickAddTaskSaveButton');
    const quickAddTaskCancelButton = document.getElementById('quickAddTaskCancelButton');
    const quickAddTaskColorPalette = document.getElementById('quickAddTaskColorPalette');
    const quickAddTaskColorValue = document.getElementById('quickAddTaskColorValue');
    const quickAddExistingTaskMessage = document.getElementById('quickAddExistingTaskMessage');

    // タスク編集ポップアップの要素
    const popupEditTaskName = document.getElementById('popupEditTaskName');
    const popupEditStartTime = document.getElementById('popupEditStartTime');
    const popupEditEndTime = document.getElementById('popupEditEndTime');
    const popupEditTaskColorPalette = document.getElementById('popupEditTaskColorPalette');
    const popupEditTaskColorValue = document.getElementById('popupEditTaskColorValue');
    const popupEditDayCheckboxes = document.getElementById('popupEditDayCheckboxes');
    const popupUpdateButton = document.getElementById('popupUpdateButton');
    const popupDeleteButton = document.getElementById('popupDeleteButton');

    // 重複ダイアログの要素
    const overwriteButton = document.getElementById('overwriteButton');
    const cancelOverlapButton = document.getElementById('cancelOverlapButton');

    // スクロールバーの幅を計算
    const measureScrollbar = () => {
        const div = document.createElement('div');
        div.style.width = '100px';
        div.style.height = '100px';
        div.style.overflow = 'scroll';
        div.style.position = 'absolute';
        div.style.top = '-9999px';
        document.body.appendChild(div);
        scrollbarWidth = div.offsetWidth - div.clientWidth;
        document.body.removeChild(div);
    };
    measureScrollbar();

    // 認証状態の監視
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUserId = user.uid;
            userIdDisplay.textContent = `ユーザーID: ${currentUserId}`;
            setupFirestoreListener();
            setupTemplateListener();
            startTaskChecker();
        } else {
            try {
                await signInAnonymously(auth);
            } catch (error) {
                console.error("Firebase authentication error:", error);
            }
        }
    });
    
    // Firestoreのリスナー設定
    function setupFirestoreListener() {
        if (!currentUserId) return;
        const tasksCollectionRef = collection(db, "tasks");
        const q = query(tasksCollectionRef, where("userId", "==", currentUserId));
        onSnapshot(q, (snapshot) => {
            tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            tasks.sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
            renderCalendar();
            updateActiveTask();
        }, (error) => { console.error("Task listener error: ", error); });
    }
    
    function setupTemplateListener() {
        if (!currentUserId) return;
        const templatesRef = collection(db, "templates");
        const q = query(templatesRef, where("userId", "==", currentUserId));
        onSnapshot(q, (snapshot) => {
            templates = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderTemplateList();
        }, (error) => { console.error("Template listener error: ", error); });
    }

    // 時刻文字列を分に変換
    function timeToMinutes(timeStr) {
        if (!timeStr) return 0;
        const [hours, minutes] = timeStr.split(':').map(Number);
        return hours * 60 + minutes;
    }
    // 分を時刻文字列に変換
    function minutesToTime(minutes) {
        const h = Math.floor(minutes / 60) % 24;
        const m = minutes % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    // カレンダーの描画
    function renderCalendar() {
        const fragment = document.createDocumentFragment();
        ['日', '月', '火', '水', '木', '金', '土'].forEach(dayName => {
            const dayHeader = document.createElement('div');
            dayHeader.className = 'calendar-header';
            dayHeader.textContent = dayName;
            fragment.appendChild(dayHeader);
        });
        const dayColumns = Array.from({ length: 7 }, (_, i) => {
            const dayCol = document.createElement('div');
            dayCol.className = 'calendar-day-column';
            dayCol.dataset.dayIndex = i;
            for (let hour = 0; hour < 24; hour++) {
                const hourMarker = document.createElement('div');
                hourMarker.className = 'calendar-hour-marker';
                hourMarker.setAttribute('data-hour', hour);
                dayCol.appendChild(hourMarker);
            }
            fragment.appendChild(dayCol);
            return dayCol;
        });
        tasks.forEach(task => {
            if (!task.startTime || !task.endTime || !task.days) return;
            const startMins = timeToMinutes(task.startTime);
            let endMins = timeToMinutes(task.endTime);
            if (endMins <= startMins) endMins += 1440;
            const durationMins = endMins - startMins;
            const top = (startMins / 60) * 40;
            const height = (durationMins / 60) * 40;
            task.days.forEach(dayIndex => {
                const targetCol = dayColumns[dayIndex];
                if (targetCol) {
                    const taskElement = document.createElement('div');
                    taskElement.className = 'calendar-task';
                    taskElement.style.top = `${top}px`;
                    taskElement.style.height = `${height}px`;
                    taskElement.textContent = task.name;
                    taskElement.style.backgroundColor = task.color || '#FFFFFF';
                    taskElement.style.color = task.textColor || '#000000';
                    taskElement.dataset.taskId = task.id;
                    targetCol.appendChild(taskElement);
                }
            });
        });
        calendarGrid.innerHTML = '';
        calendarGrid.appendChild(fragment);
        noTasksMessage.style.display = tasks.length === 0 ? 'block' : 'none';
    }
    
    // カレンダーのクリックイベント
    calendarGrid.addEventListener('click', (e) => {
        if (isPopupOpen) return;
        const clickedTaskElement = e.target.closest('.calendar-task');
        if (clickedTaskElement) {
            const taskId = clickedTaskElement.dataset.taskId;
            const taskToEdit = tasks.find(t => t.id === taskId);
            if (taskToEdit) openEditTaskPopup(taskToEdit);
            return;
        }
        const dayColumn = e.target.closest('.calendar-day-column');
        if (dayColumn) {
            const dayIndex = parseInt(dayColumn.dataset.dayIndex, 10);
            const rect = dayColumn.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            const clickedMinutes = Math.floor(clickY / 40 * 60);
            const tasksOnDay = tasks.filter(t => t.days.includes(dayIndex)).sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));
            let prevTaskEnd = 0;
            let nextTaskStart = 1440;
            for (const task of tasksOnDay) {
                const startMins = timeToMinutes(task.startTime);
                const endMins = timeToMinutes(task.endTime);
                if (endMins <= clickedMinutes) prevTaskEnd = Math.max(prevTaskEnd, endMins);
                if (startMins >= clickedMinutes) nextTaskStart = Math.min(nextTaskStart, startMins);
            }
            const startTime = minutesToTime(prevTaskEnd);
            const endTime = minutesToTime(nextTaskStart);
            openQuickAddTaskPopup({ dayIndex, startTime, endTime });
        }
    });

    function openPopup(popupElement) {
        if (!popupElement) return;
        isPopupOpen = true;
        document.body.classList.add('popup-open');
        document.body.style.paddingRight = `${scrollbarWidth}px`;
        popupElement.style.display = 'flex';
    }

    function closePopup(popupElement) {
        if (!popupElement) return;
        popupElement.style.display = 'none';
        isPopupOpen = false;
        document.body.classList.remove('popup-open');
        document.body.style.paddingRight = '';
    }

    function populateDayCheckboxes(container, checkedDays = []) {
        const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
        container.innerHTML = '';
        for (let i = 0; i < 7; i++) {
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.value = i;
            if (checkedDays.includes(i)) checkbox.checked = true;
            const span = document.createElement('span');
            span.textContent = dayNames[i];
            label.appendChild(span);
            label.appendChild(checkbox);
            container.appendChild(label);
        }
    }

    function populateColorPalette(container, colorValueInput, selectedColor) {
        container.innerHTML = '';
        colors.forEach(color => {
            const colorDiv = document.createElement('div');
            colorDiv.className = 'color-palette-item';
            if (color.value === '#FFFFFF') colorDiv.classList.add('white-swatch');
            colorDiv.style.backgroundColor = color.value;
            if (color.value === selectedColor) {
                colorDiv.classList.add('selected');
                colorValueInput.value = color.value;
            }
            colorDiv.addEventListener('click', () => {
                if(container.classList.contains('disabled')) return;
                container.querySelector('.selected')?.classList.remove('selected');
                colorDiv.classList.add('selected');
                colorValueInput.value = color.value;
            });
            container.appendChild(colorDiv);
        });
    }

    function openQuickAddTaskPopup(defaults = {}) {
        quickAddTaskNameInput.value = defaults.name || '';
        quickAddStartTimeInput.value = defaults.startTime || '09:00';
        quickAddEndTimeInput.value = defaults.endTime || '10:00';
        quickAddExistingTaskMessage.style.display = 'none';
        quickAddTaskColorPalette.classList.remove('disabled');
        populateDayCheckboxes(quickAddDayCheckboxes, [defaults.dayIndex]);
        populateColorPalette(quickAddTaskColorPalette, quickAddTaskColorValue, colors[1].value);
        openPopup(quickAddTaskPopup);
    }

    function closeQuickAddTaskPopup() {
        closePopup(quickAddTaskPopup);
    }
    
    function openEditTaskPopup(task) {
        currentEditingTaskId = task.id;
        popupEditTaskName.value = task.name;
        popupEditStartTime.value = task.startTime;
        popupEditEndTime.value = task.endTime;
        populateDayCheckboxes(popupEditDayCheckboxes, task.days);
        populateColorPalette(popupEditTaskColorPalette, popupEditTaskColorValue, task.color);
        openPopup(calendarTaskPopup);
    }

    function closeEditTaskPopup() {
        closePopup(calendarTaskPopup);
        currentEditingTaskId = null;
    }

    function checkForOverlap(newTask, editingId = null) {
        let newStart = timeToMinutes(newTask.startTime);
        let newEnd = timeToMinutes(newTask.endTime);
        if (newEnd <= newStart) newEnd += 1440;

        const conflictingTasks = tasks.filter(existingTask => {
            if (existingTask.id === editingId) return false;
            
            const hasCommonDay = newTask.days.some(day => existingTask.days.includes(day));
            if (!hasCommonDay) return false;

            let existingStart = timeToMinutes(existingTask.startTime);
            let existingEnd = timeToMinutes(existingTask.endTime);
            if (existingEnd <= existingStart) existingEnd += 1440;

            return newStart < existingEnd && existingStart < newEnd;
        });

        return conflictingTasks;
    }

    quickAddTaskNameInput.addEventListener('input', (e) => {
        const name = e.target.value.trim();
        const existingTask = tasks.find(task => task.name === name);
        if (existingTask) {
            quickAddExistingTaskMessage.style.display = 'inline';
            quickAddTaskColorPalette.classList.add('disabled');
            populateColorPalette(quickAddTaskColorPalette, quickAddTaskColorValue, existingTask.color);
        } else {
            quickAddExistingTaskMessage.style.display = 'none';
            quickAddTaskColorPalette.classList.remove('disabled');
        }
    });

    async function handleSave(taskData, mode) {
        const conflictingTasks = checkForOverlap(taskData, mode === 'update' ? currentEditingTaskId : null);
        if (conflictingTasks.length > 0) {
            handleOverlap(taskData, conflictingTasks, mode);
        } else {
            if (mode === 'add') await saveNewTask(taskData);
            else if (mode === 'update') await updateExistingTask(taskData);
        }
    }

    quickAddTaskSaveButton.addEventListener('click', () => {
        const name = quickAddTaskNameInput.value.trim();
        if (!name) return alert('タスク名を入力してください。');
        const selectedDays = Array.from(quickAddDayCheckboxes.querySelectorAll('input:checked')).map(cb => parseInt(cb.value));
        if (selectedDays.length === 0) return alert('曜日を一つ以上選択してください。');
        const selectedColor = colors.find(c => c.value === quickAddTaskColorValue.value) || colors[0];
        const taskData = { name, days: selectedDays, startTime: quickAddStartTimeInput.value, endTime: quickAddEndTimeInput.value, color: selectedColor.value, textColor: selectedColor.textColor };
        handleSave(taskData, 'add');
    });
    
    popupUpdateButton.addEventListener('click', () => {
        if (!currentEditingTaskId) return;
        const name = popupEditTaskName.value.trim();
        if (!name) return alert('タスク名を入力してください。');
        const selectedDays = Array.from(popupEditDayCheckboxes.querySelectorAll('input:checked')).map(cb => parseInt(cb.value));
        if (selectedDays.length === 0) return alert('曜日を一つ以上選択してください。');
        const selectedColor = colors.find(c => c.value === popupEditTaskColorValue.value) || colors[0];
        const taskData = { name, days: selectedDays, startTime: popupEditStartTime.value, endTime: popupEditEndTime.value, color: selectedColor.value, textColor: selectedColor.textColor };
        handleSave(taskData, 'update');
    });

    popupDeleteButton.addEventListener('click', async () => {
        if (!currentEditingTaskId) return;
        if (confirm('このタスクを本当に削除しますか？')) {
            try {
                await deleteDoc(doc(db, "tasks", currentEditingTaskId));
                closeEditTaskPopup();
            } catch (error) { console.error("Error deleting document: ", error); }
        }
    });
    
    function handleOverlap(taskData, conflictingTasks, mode) {
        tempTaskData = { ...taskData, mode: mode }; 
        if (mode === 'add') closePopup(quickAddTaskPopup);
        else if (mode === 'update') closePopup(calendarTaskPopup);
        openPopup(overlapDialog);
    }
    
    overwriteButton.addEventListener('click', async () => {
        const batch = writeBatch(db);
        const conflictingTaskIds = checkForOverlap(tempTaskData, tempTaskData.mode === 'update' ? currentEditingTaskId : null).map(t => t.id);
        conflictingTaskIds.forEach(id => batch.delete(doc(db, "tasks", id)));

        if (tempTaskData.mode === 'add') {
            const newTaskRef = doc(collection(db, "tasks"));
            const { mode, ...taskToSave } = tempTaskData;
            batch.set(newTaskRef, { ...taskToSave, userId: currentUserId });
        } else if (tempTaskData.mode === 'update') {
            const taskRef = doc(db, "tasks", currentEditingTaskId);
            const { mode, ...taskToSave } = tempTaskData;
            batch.update(taskRef, taskToSave);
        }
        await batch.commit();
        closePopup(overlapDialog);
        tempTaskData = null;
        if (tempTaskData?.mode === 'update') currentEditingTaskId = null;
    });

    cancelOverlapButton.addEventListener('click', () => {
        closePopup(overlapDialog);
        if (tempTaskData.mode === 'add') {
            openQuickAddTaskPopup({ name: tempTaskData.name, startTime: tempTaskData.startTime, endTime: tempTaskData.endTime, dayIndex: tempTaskData.days[0] });
        } else if (tempTaskData.mode === 'update') {
            const originalTask = { ...tempTaskData, id: currentEditingTaskId };
            openEditTaskPopup(originalTask);
        }
        tempTaskData = null; 
    });
    
    async function saveNewTask(taskData) {
        try {
            await addDoc(collection(db, "tasks"), { ...taskData, userId: currentUserId });
            closeQuickAddTaskPopup();
        } catch (error) { console.error("Error adding document: ", error); }
    }

    async function updateExistingTask(taskData) {
        try {
            const taskRef = doc(db, "tasks", currentEditingTaskId);
            await updateDoc(taskRef, taskData);
            closeEditTaskPopup();
        } catch (error) { console.error("Error updating document: ", error); }
    }

    quickAddTaskCancelButton.addEventListener('click', closeQuickAddTaskPopup);
    
    document.querySelectorAll('.popup-close-button').forEach(button => {
        button.addEventListener('click', (e) => closePopup(e.target.closest('.popup-base')));
    });

    templateActionsButton.addEventListener('click', (e) => {
        e.stopPropagation();
        templateDropdownMenu.classList.toggle('active');
    });

    document.addEventListener('click', () => {
        if (templateDropdownMenu.classList.contains('active')) {
            templateDropdownMenu.classList.remove('active');
        }
    });

    saveScheduleAsTemplateButton.addEventListener('click', () => {
        templateDropdownMenu.classList.remove('active');
        templateNameInput.value = '';
        openPopup(saveTemplatePopup);
    });

    saveTemplateConfirmButton.addEventListener('click', async () => {
        const name = templateNameInput.value.trim();
        if (!name) return alert('テンプレート名を入力してください。');
        const templateTasks = tasks.map(({ id, userId, ...rest }) => rest);
        const newTemplate = { userId: currentUserId, name, tasks: templateTasks, createdAt: serverTimestamp() };
        try {
            await addDoc(collection(db, "templates"), newTemplate);
            showNotification('テンプレートが保存されました');
            closePopup(saveTemplatePopup);
        } catch (error) { console.error("Error saving template: ", error); }
    });

    saveTemplateCancelButton.addEventListener('click', () => closePopup(saveTemplatePopup));
    
    function renderTemplateList() {
        templateListContainer.innerHTML = '';
        if (templates.length === 0) {
            const noTemplates = document.createElement('div');
            noTemplates.textContent = '保存されたテンプレートはありません';
            noTemplates.className = 'text-gray-500 p-2 text-sm';
            templateListContainer.appendChild(noTemplates);
            return;
        }
        templates.forEach(template => {
            const item = document.createElement('div');
            item.className = 'template-item';
            const loadButton = document.createElement('button');
            loadButton.textContent = template.name;
            loadButton.className = 'template-item-load';
            loadButton.dataset.templateId = template.id;
            const deleteButton = document.createElement('button');
            deleteButton.innerHTML = '🗑️';
            deleteButton.className = 'template-item-delete';
            deleteButton.dataset.templateId = template.id;
            deleteButton.dataset.templateName = template.name;
            item.appendChild(loadButton);
            item.appendChild(deleteButton);
            templateListContainer.appendChild(item);
        });
    }

    templateListContainer.addEventListener('click', async (e) => {
        const templateId = e.target.dataset.templateId;
        if (!templateId) return;
        if (e.target.classList.contains('template-item-load')) {
            if (confirm(`テンプレート「${e.target.textContent}」を読み込みますか？\n現在のスケジュールは上書きされます。`)) {
                const selectedTemplate = templates.find(t => t.id === templateId);
                if (selectedTemplate) {
                    const batch = writeBatch(db);
                    tasks.forEach(task => batch.delete(doc(db, "tasks", task.id)));
                    selectedTemplate.tasks.forEach(task => {
                        const newTaskRef = doc(collection(db, "tasks"));
                        batch.set(newTaskRef, { ...task, userId: currentUserId });
                    });
                    await batch.commit();
                    showNotification('テンプレートを読み込みました');
                    templateDropdownMenu.classList.remove('active');
                }
            }
        } else if (e.target.classList.contains('template-item-delete')) {
             if (confirm(`テンプレート「${e.target.dataset.templateName}」を本当に削除しますか？`)) {
                await deleteDoc(doc(db, "templates", templateId));
                showNotification('テンプレートを削除しました');
             }
        }
    });

    function showNotification(message) {
        notificationBanner.textContent = message;
        notificationBanner.classList.add('show');
        setTimeout(() => {
            notificationBanner.classList.remove('show');
        }, 3000);
    }

    function updateActiveTask() {
        if (taskCheckTimeout) clearTimeout(taskCheckTimeout);
        const now = new Date();
        const currentDay = now.getDay();
        const currentTimeInMinutes = now.getHours() * 60 + now.getMinutes();
        const foundTask = tasks.find(task => {
            if (!task.days || !task.days.includes(currentDay)) return false;
            const startMins = timeToMinutes(task.startTime);
            const endMins = timeToMinutes(task.endTime);
            const isOvernight = endMins <= startMins;
            if (isOvernight) {
                return currentTimeInMinutes >= startMins || currentTimeInMinutes < endMins;
            } else {
                return currentTimeInMinutes >= startMins && currentTimeInMinutes < endMins;
            }
        });
        activeTask = foundTask || null;
        updateTaskDisplay();
        const seconds = now.getSeconds();
        const delay = (60 - seconds) * 1000;
        taskCheckTimeout = setTimeout(updateActiveTask, delay);
    }
    
    function updateTaskDisplay() {
        const currentTaskText = document.getElementById('currentTaskText');
        const taskProgressBar = document.getElementById('taskProgressBar');
        if (activeTask) {
            currentTaskText.textContent = activeTask.name;
            taskProgressBar.style.backgroundColor = activeTask.color || '#4299e1';
        } else {
            currentTaskText.textContent = "自由時間";
            taskProgressBar.style.width = '0%';
        }
    }

    function updateProgressBar() {
        const taskProgressBar = document.getElementById('taskProgressBar');
        if (!activeTask) {
            taskProgressBar.style.width = '0%';
            return;
        }
        const now = new Date();
        let currentTimeInMinutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
        const startMins = timeToMinutes(activeTask.startTime);
        let endMins = timeToMinutes(activeTask.endTime);
        if (endMins <= startMins) {
            endMins += 1440;
            if (currentTimeInMinutes < startMins) currentTimeInMinutes += 1440;
        }
        const totalDuration = endMins - startMins;
        const elapsedDuration = currentTimeInMinutes - startMins;
        if (totalDuration > 0) {
            const progress = Math.min(100, Math.max(0, (elapsedDuration / totalDuration) * 100));
            taskProgressBar.style.width = `${progress}%`;
        } else {
            taskProgressBar.style.width = '0%';
        }
    }
    
    function startTaskChecker() {
        stopTaskChecker();
        updateActiveTask();
        progressBarInterval = setInterval(updateProgressBar, 1000);
    }

    function stopTaskChecker() {
        if (taskCheckTimeout) clearTimeout(taskCheckTimeout);
        if (progressBarInterval) clearInterval(progressBarInterval);
        taskCheckTimeout = null;
        progressBarInterval = null;
    }

    settingsButton.addEventListener('click', () => {
        stopTaskChecker();
        fullScreenOverlay.classList.add('hidden');
        settingsPanel.style.display = 'block';
    });

    backButton.addEventListener('click', () => {
        settingsPanel.style.display = 'none';
        fullScreenOverlay.classList.remove('hidden');
        startTaskChecker();
    });
});