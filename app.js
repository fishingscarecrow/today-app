
/* Today — application logic */

const TODAY_APP_VERSION = "runtime-fix-v1";
const TODAY_DATA_VERSION = 5;


function safeStorageGet(key, fallback = null) {
    try {
        const value = window.localStorage.getItem(key);
        return value === null ? fallback : value;
    } catch (error) {
        return fallback;
    }
}

function safeStorageSet(key, value) {
    try {
        window.localStorage.setItem(key, String(value));
        return true;
    } catch (error) {
        return false;
    }
}

function safeStorageRemove(key) {
    try {
        window.localStorage.removeItem(key);
        return true;
    } catch (error) {
        return false;
    }
}

function safeReadJSON(key, fallback) {
    try {
        const raw = safeStorageGet(key);
        if (!raw) return fallback;

        const parsed = JSON.parse(raw);
        return parsed ?? fallback;
    } catch (error) {
        console.warn(`Today recovered from invalid saved data in ${key}.`);
        return fallback;
    }
}

let tasks = safeReadJSON("tasks", []);
if (!Array.isArray(tasks)) tasks = [];

let events = safeReadJSON("events", []);
if (!Array.isArray(events)) events = [];

let projects = safeReadJSON("projects", ["School", "Personal", "Work"]);
if (!Array.isArray(projects)) projects = ["School", "Personal", "Work"];
projects = [...new Set(projects.map(project => String(project || "").trim()).filter(Boolean))];

let dailyNotes = safeReadJSON("dailyNotes", {});
if (!dailyNotes || typeof dailyNotes !== "object" || Array.isArray(dailyNotes)) {
    dailyNotes = {};
}

let currentTaskFilter = safeStorageGet("taskFilter") || "all";
let currentProjectFilter = safeStorageGet("projectFilter") || "all";

let activityHistory = safeReadJSON("activityHistory", {});
if (!activityHistory || typeof activityHistory !== "object" || Array.isArray(activityHistory)) {
    activityHistory = {};
}

let dailyGoal = Math.max(1, Number(safeStorageGet("dailyGoal")) || 3);
let accentColor = safeStorageGet("accentColor") || "graphite";
let editingTaskIndex = null;
let editingEventIndex = null;
let currentReminderNoticeKey = "";
let reminderCheckTimer = null;
let selectedCalendarDate = safeStorageGet("selectedCalendarDate") || getDateKey();
let appLanguage = safeStorageGet("appLanguage") || "en";
let calendarView = safeStorageGet("calendarView") || "week";
let deferredInstallPrompt = null;
let onboardingStep = 0;
let controlTourIndex = 0;
let controlTourActiveTarget = null;
let todayServiceWorkerRegistration = null;
let pendingTodayServiceWorker = null;
let todayReloadingForUpdate = false;
    function createLocalId(prefix = "item") {
        return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    }

    function normalizeStoredData() {
        const validPriorities = ["low", "medium", "high"];
        const validRepeats = ["none", "daily", "weekly", "custom"];
        const validRepeatUnits = ["days", "weeks"];

        let tasksChanged = false;

        tasks = tasks
            .filter(task => task && typeof task === "object")
            .map(task => {
                const normalized = { ...task };

                if (!normalized.id || typeof normalized.id !== "string") {
                    normalized.id = createLocalId("task");
                    tasksChanged = true;
                }

                if (typeof normalized.text !== "string") {
                    normalized.text = String(normalized.text || "").trim();
                    tasksChanged = true;
                }

                if (typeof normalized.completed !== "boolean") {
                    normalized.completed = Boolean(normalized.completed);
                    tasksChanged = true;
                }

                if (!validPriorities.includes(normalized.priority)) {
                    normalized.priority = "medium";
                    tasksChanged = true;
                }

                if (typeof normalized.dueDate !== "string") {
                    normalized.dueDate = "";
                    tasksChanged = true;
                }

                if (!validRepeats.includes(normalized.repeat)) {
                    normalized.repeat = "none";
                    tasksChanged = true;
                }

                const repeatEvery = Math.min(
                    365,
                    Math.max(1, Number(normalized.repeatEvery) || 1)
                );

                if (normalized.repeatEvery !== repeatEvery) {
                    normalized.repeatEvery = repeatEvery;
                    tasksChanged = true;
                }

                if (!validRepeatUnits.includes(normalized.repeatUnit)) {
                    normalized.repeatUnit = "days";
                    tasksChanged = true;
                }

                if (typeof normalized.reminderTime !== "string") {
                    normalized.reminderTime = "";
                    tasksChanged = true;
                }

                if (typeof normalized.archived !== "boolean") {
                    normalized.archived = false;
                    tasksChanged = true;
                }

                if (typeof normalized.recurrenceGenerated !== "boolean") {
                    normalized.recurrenceGenerated = false;
                    tasksChanged = true;
                }

                if (typeof normalized.generatedFromId !== "string") {
                    normalized.generatedFromId = "";
                    tasksChanged = true;
                }

                if (typeof normalized.focusDate !== "string") {
                    normalized.focusDate = "";
                    tasksChanged = true;
                }

                if (typeof normalized.project !== "string") {
                    normalized.project = "";
                    tasksChanged = true;
                }

                if (typeof normalized.completedOn !== "string") {
                    normalized.completedOn = "";
                    tasksChanged = true;
                }

                if (
                    normalized.templateItemKey &&
                    !translations.en[normalized.templateItemKey]
                ) {
                    delete normalized.templateItemKey;
                    tasksChanged = true;
                }

                return normalized;
            })
            .filter(task => task.text.length > 0);

        if (tasksChanged) {
            safeStorageSet("tasks", JSON.stringify(tasks));
        }

        let eventsChanged = false;
        const todayKey = getDateKey();

        events = events
            .filter(event => event && typeof event === "object")
            .map(event => {
                const normalized = { ...event };

                if (!normalized.id || typeof normalized.id !== "string") {
                    normalized.id = createLocalId("event");
                    eventsChanged = true;
                }

                if (typeof normalized.name !== "string") {
                    normalized.name = String(normalized.name || "").trim();
                    eventsChanged = true;
                }

                if (typeof normalized.time !== "string") {
                    normalized.time = "";
                    eventsChanged = true;
                }

                if (typeof normalized.date !== "string" || !normalized.date) {
                    normalized.date = todayKey;
                    eventsChanged = true;
                }

                if (!["none", "daily", "weekly", "custom"].includes(normalized.repeat)) {
                    normalized.repeat = "none";
                    eventsChanged = true;
                }

                const normalizedRepeatEvery = Math.min(
                    365,
                    Math.max(1, Number(normalized.repeatEvery) || 1)
                );

                if (normalized.repeatEvery !== normalizedRepeatEvery) {
                    normalized.repeatEvery = normalizedRepeatEvery;
                    eventsChanged = true;
                }

                if (!["days", "weeks"].includes(normalized.repeatUnit)) {
                    normalized.repeatUnit = "days";
                    eventsChanged = true;
                }

                return normalized;
            })
            .filter(event => event.name.length > 0);
        if (eventsChanged) {
            safeStorageSet("events", JSON.stringify(events));
        }

        Object.keys(activityHistory).forEach(key => {
            const value = Math.max(0, Number(activityHistory[key]) || 0);

            if (value === 0) {
                delete activityHistory[key];
            } else {
                activityHistory[key] = value;
            }
        });

        safeStorageSet("activityHistory", JSON.stringify(activityHistory));
        safeStorageSet("projects", JSON.stringify(projects));

        const legacyNotes = safeStorageGet("notes");
        const todayForLegacyNotes = getDateKey();

        if (
            legacyNotes &&
            !dailyNotes[todayForLegacyNotes] &&
            safeStorageGet("dailyNotesMigrated") !== "true"
        ) {
            dailyNotes[todayForLegacyNotes] = legacyNotes;
            safeStorageSet("dailyNotes", JSON.stringify(dailyNotes));
            safeStorageSet("dailyNotesMigrated", "true");
        }

        safeStorageSet("todayDataVersion", String(TODAY_DATA_VERSION));
    }

    const translations = {
        en: {
            "cloudSync": "Cloud Sync",
            "cloudSyncDesc": "Keep this Today data synced across your devices",
            "cloudLocalOnly": "Local only",
            "cloudOnlineOnly": "Cloud sync works on the online HTTPS version",
            "cloudReady": "Synced",
            "cloudSyncing": "Syncing…",
            "cloudChecking": "Checking cloud…",
            "cloudError": "Sync unavailable",
            "cloudNeedsStorage": "Cloud storage is not connected yet",
            "cloudCreate": "Create sync",
            "cloudConnect": "Connect code",
            "cloudSyncNow": "Sync now",
            "cloudDisconnect": "Disconnect",
            "cloudCodeLabel": "Your sync code",
            "cloudCopy": "Copy",
            "cloudCopied": "Copied",
            "cloudPrivacy": "Your planner is encrypted in the browser before it is uploaded. Keep the sync code private.",
            "cloudEnterCode": "Enter your Today sync code",
            "cloudInvalidCode": "That sync code is not valid.",
            "cloudCodeNotFound": "I couldn't find data for that sync code.",
            "cloudConnectConfirm": "This will replace the Today data on this device with the cloud copy. Continue?",
            "cloudDisconnectConfirm": "Disconnect this device from cloud sync? Your local Today data will stay here.",
            "cloudCreatedMessage": "Cloud sync is ready. Copy this code and enter it on your other device.",
            "cloudSetupNeeded": "The Cloud Sync code is installed, but Vercel Blob storage still needs to be connected to this project.",
            "cloudDecryptionError": "That code could not decrypt this cloud backup.",
            "cloudUpdatedFromOtherDevice": "Updated from another device",

            "previewTask": "Task",
            "previewEvent": "Event",
            "previewToday": "Today",
            "previewTomorrow": "Tomorrow",
            "previewProject": "Project: {project}",
            "previewTime": "Time: {time}",
            "previewDate": "Date: {date}",
            "previewPriority": "{priority} priority",
            "noteSaving": "Saving…",
            "noteSaved": "Saved",
            "emptyTasks": "Nothing matches these filters.",
            "emptySchedule": "No events on this day.",
            "shortcutQuickAdd": "Press / to jump to Quick Add",

            "guideSetting": "Guide",
            "guideSettingDesc": "Learn what each part of Today does",
            "startGuide": "Start tour",
            "guideBack": "Back",
            "guideNext": "Next",
            "guideFinish": "Finish",
            "guideSkip": "Skip tour",
            "guideClose": "Close guide",
            "guideStep": "{current} / {total}",
            "tourQuickTitle": "Quick Add",
            "tourQuickText": "The fastest way to add something. Pick Task or Event, then type normally. Today can pull out dates, priorities, projects, and event times from the text.",
            "tourQuickExample": "Task: Math homework tomorrow high @School\nEvent: Dentist tomorrow 15:30",
            "tourFocusTitle": "Focus 3",
            "tourFocusText": "Star up to three tasks for today. They stay in this small list so your most important work does not disappear inside a long task list.",
            "tourTemplatesTitle": "Templates",
            "tourTemplatesText": "One tap creates a ready-made routine. You can still edit, complete, archive, or move those tasks like normal.",
            "tourStatsTitle": "Goals and progress",
            "tourStatsText": "This area tracks streaks, completed tasks, your daily goal, weekly history, smart tips, and milestones.",
            "tourReminderTitle": "Reminder Center",
            "tourReminderText": "This gathers what needs attention: tasks due today, future reminders, and overdue tasks.",
            "tourTaskTitle": "Full task controls",
            "tourTaskText": "Use this when you want precise control. Set the task name, priority, due date, project, repeat rule, and optional reminder time before pressing Add.",
            "tourSearchTitle": "Search and filters",
            "tourSearchText": "Search across tasks, schedule events, and daily notes. The filter buttons narrow the task list, and the Project menu can show one category at a time.",
            "tourTomorrowTitle": "Tomorrow and Evening Reset",
            "tourTomorrowText": "Plan tomorrow ahead of time. The Evening Reset can review today or move unfinished tasks forward.",
            "tourCalendarTitle": "Calendar",
            "tourCalendarText": "Switch between Week and Month. Pick a date to see its agenda, then use + Task or + Event to prepare an item for that date.",
            "tourScheduleTitle": "Schedule",
            "tourScheduleText": "Events have a time and date and can repeat daily, weekly, or on a custom interval. Recurring events appear on future matching dates automatically.",
            "tourNotesTitle": "Daily Note",
            "tourNotesText": "Each calendar date has its own note. Selecting another day swaps to that day's note automatically.",
            "tourSettingsTitle": "Theme, language, backups, and app controls",
            "tourSettingsText": "Settings contains light/dark mode, accent colors, notifications, install options, version checks, backups, language, and this guide. You can replay the tour anytime.",

            "project": "Project",
            "allProjects": "All projects",
            "inboxProject": "Inbox",
            "newProjectPrompt": "Project name",
            "projectExists": "That project already exists.",
            "dailyNote": "Daily Note",
            "notesPlaceholder": "Write anything for this day...",
            "smartQuickHint": "Try: Math homework tomorrow high @School",
            "eventRepeat": "Repeat",
            "scheduleType": "Schedule",
            "taskTypeLabel": "Task",
            "doneStatus": "Done",
            "openStatus": "Open",
            "priorityWord": "priority",

            "versionSetting": "App version",
            "versionSettingDesc": "Check whether a newer Today build is available",
            "checkUpdate": "Check",
            "checkingUpdate": "Checking for updates…",
            "upToDate": "Today is up to date.",
            "updateCheckUnavailable": "Update checks work on the hosted / Live Server version.",
            "updateReadyTitle": "Update available",
            "updateReadyText": "A newer version of Today is ready.",
            "updateLater": "Later",
            "updateRefresh": "Refresh",
            "migrationNote": "Moving Today to a new web address? Export a backup first — browser data does not automatically move between addresses.",
            "offlineStatus": "You're offline — Today can still use saved local data.",
            "onlineStatus": "Back online.",

            "focusTitle": "⭐ Focus 3",
            "focusSubtitle": "Choose up to three things that matter most today.",
            "focusEmpty": "Star tasks below to build today's focus list.",
            "focusLimit": "You already have three focus tasks for today.",
            "focusAdded": "Added to today's focus.",
            "focusRemoved": "Removed from today's focus.",
            "focusDone": "Done",
            "focusOpen": "Open",
            "addToFocus": "Add to today's Focus 3",
            "removeFromFocus": "Remove from today's Focus 3",

            "previousMonth": "Previous month",
            "nextMonth": "Next month",
            "agendaAddTask": "+ Task",
            "agendaAddEvent": "+ Event",
            "calendarTaskCount": "{count} task{suffix}",
            "calendarEventCount": "{count} event{suffix}",

            "streakLabel": "🔥 Streak",
            "completedTodayLabel": "✅ Completed today",
            "lastSevenDaysLabel": "📅 Last 7 days",
            "templateCheckHomework": "Check homework",
            "templatePackSchoolBag": "Pack school bag",
            "templatePrepareTomorrow": "Prepare for tomorrow",
            "templateReviewTodayPlan": "Review today's plan",
            "templateImportantTask": "Complete one important task",
            "templateRoomReset": "Quick room reset",
            "templateTidyWorkspace": "Tidy workspace",
            "templateReviewUnfinished": "Review unfinished tasks",
            "templatePlanNextWeek": "Plan the next week",

            "templates": "🧩 Templates",
            "templatesSubtitle": "Add a ready-made routine in one tap.",
            "schoolTemplate": "🎒 School Day",
            "schoolTemplateDesc": "Homework, bag check, and tomorrow prep.",
            "morningTemplate": "☀️ Productive Morning",
            "morningTemplateDesc": "A simple start-of-day routine.",
            "resetTemplate": "🧹 Weekend Reset",
            "resetTemplateDesc": "Tidy up, review, and prepare for the week.",
            "templateAdded": "Routine added for today.",
            "weekView": "Week",
            "monthView": "Month",
            "installToday": "Install Today",
            "installTodayDesc": "Use Today like an app on your device",
            "installCardTitle": "Add Today to your device",
            "installAvailable": "Install Today directly from this browser.",
            "installIos": "On iPhone: open Today in Safari, tap Share, then Add to Home Screen.",
            "installUnavailable": "This browser does not currently offer direct installation.",
            "install": "Install",
            "onboardWelcomeTitle": "Welcome to Today",
            "onboardWelcomeText": "A few quick choices will make the app feel more like yours.",
            "onboardLanguage": "Language",
            "onboardGoalTitle": "Set a daily goal",
            "onboardGoalText": "Choose a realistic number of tasks you want to complete on a normal day.",
            "onboardGoalLabel": "Tasks per day",
            "onboardStyleTitle": "Pick your style",
            "onboardStyleText": "Choose an accent color. You can change it anytime in Settings.",
            "onboardAccent": "Accent color",
            "skip": "Skip",
            "next": "Next",
            "finish": "Finish",

            "quickAdd": "⚡ Quick Add",
            "quickAddHint": "Add something without opening extra controls.",
            "quickAddPlaceholder": "Add a task or event...",
            "quickAddedTask": "Task added for today.",
            "quickAddedEvent": "Event added to today's schedule.",
            "quickNeedTime": "Choose a time for the event.",
            "quickNeedText": "Type something first.",
            "reminderCenter": "🔔 Reminder Center",
            "reminderCenterSubtitle": "What needs your attention next.",
            "dueTodayCenter": "Due today",
            "upcomingReminders": "Upcoming reminders",
            "overdueCenter": "Overdue",
            "noReminderItems": "Nothing urgent right now.",
            "reminderAt": "Reminder at {time}",
            "eveningReset": "🌙 Evening Reset",
            "eveningResetSubtitle": "Wrap up today and make tomorrow easier.",
            "unfinishedToday": "{count} unfinished task{suffix} still due today.",
            "allWrapped": "Today's open tasks are wrapped up.",
            "moveUnfinished": "Move unfinished",
            "planTomorrowAction": "Plan tomorrow",
            "reviewToday": "Review today",
            "movedTomorrow": "Moved {count} unfinished task{suffix} to tomorrow.",
            "nothingToMove": "No unfinished tasks to move.",
            "taskType": "Task",
            "eventType": "Event",

            "add": "Add",
            "save": "Save",
            "cancel": "Cancel",
            "saveChanges": "Save changes",
            "editTask": "Edit task",
            "editEvent": "Edit schedule event",
            "task": "Task",
            "priority": "Priority",
            "dueDate": "Due date",
            "repeat": "Repeat",
            "reminderTime": "Reminder time",
            "every": "Every",
            "unit": "Unit",
            "event": "Event",
            "time": "Time",
            "date": "Date",
            "low": "Low",
            "medium": "Medium",
            "high": "High",
            "noRepeat": "No repeat",
            "daily": "Daily",
            "weekly": "Weekly",
            "custom": "Custom",
            "days": "Days",
            "weeks": "Weeks",
            "repeatEvery": "Repeat every",
            "all": "All",
            "today": "Today",
            "upcoming": "Upcoming",
            "active": "Active",
            "completed": "Completed",
            "highPriority": "High Priority",
            "archiveFilter": "Archived",
            "archiveCompleted": "Archive completed",
            "archiveHint": "Completed tasks can be archived instead of deleted.",
            "dismiss": "Dismiss",
            "view": "View",
            "moveToday": "Move to today",
            "overdueReview": "Review them or move them to today.",
            "planTomorrowHelp": "Tomorrow's tasks automatically appear under Today when the date changes.",
            "agenda": "Agenda",
            "schedule": "Schedule",
            "todaySchedule": "Today's Schedule",
            "previousWeek": "Previous week",
            "nextWeek": "Next week",
            "completedLabel": "Completed",
            "activeDays": "Active days",
            "bestDay": "Best day",
            "last7Days": "Last 7 days",
            "completedTasks": "Completed tasks",
            "target": "Target",
            "enable": "Enable",
            "export": "Export",
            "import": "Import",
            "browserNotificationsUnavailable": "Browser notifications: unavailable",
            "browserNotificationsEnabled": "Browser notifications: enabled",
            "browserNotificationsBlocked": "Browser notifications: blocked",
            "browserNotificationsOptional": "Browser notifications: optional",
            "reminder": "Reminder",
            "due": "Due",
            "firstStep": "First Step",
            "firstStepDesc": "Complete your first task",
            "momentum": "Momentum",
            "momentumDesc": "Complete 10 tasks",
            "threeDayStreak": "3-Day Streak",
            "threeDayStreakDesc": "Stay active for 3 days",
            "fiftyClub": "Fifty Club",
            "fiftyClubDesc": "Complete 50 tasks",
            "weekStreak": "Week Streak",
            "weekStreakDesc": "Reach a 7-day streak",
            "unlocked": "Unlocked",
            "unlockedCount": "{done} / {total} unlocked",
            "day": "day",
            "daysLower": "days",
            "weekShort": "wk",
            "dayShort": "day",
            "streakDays": "{count} day",
            "streakDaysPlural": "{count} days",
            "weeklyMore": "{count} more completed than last week so far.",
            "weeklyFewer": "{count} fewer completed than last week so far.",
            "weeklyLevel": "You're level with last week's total so far.",
            "tipOverdue": "You have {count} overdue task{suffix}. Clearing one first can make the rest of today feel lighter.",
            "tipHigh": "{count} high-priority task{suffix} {verb} due today. Consider handling {object} before lower-priority work.",
            "tipGoal": "You're {count} task{suffix} away from today's goal.",
            "tipBestDay": "Based on your saved history, {day} currently has your highest total completions.",
            "tipLearning": "Keep using Today for a few active days and this space will start showing patterns from your history.",
            "goalCelebration": "🎉 Daily goal complete!",
            "weatherClear": "Clear",
            "weatherPartly": "Partly cloudy",
            "weatherFog": "Foggy",
            "weatherRain": "Rain",
            "weatherSnow": "Snow",
            "weatherShowers": "Rain showers",
            "weatherStorm": "Thunderstorm",
            "weatherUnavailable": "Weather unavailable",

            settings: "Settings",
            appearance: "Appearance",
            appearanceDesc: "Switch between light and dark mode",
            accent: "Accent color",
            accentDesc: "Personalize buttons and progress",
            reminders: "Reminders",
            remindersDesc: "In-app reminders work automatically",
            data: "Data",
            dataDesc: "Back up or restore your Today data",
            language: "Language",
            languageDesc: "Choose Today's language",
            dailyMessage: "Daily message",
            progress: "Today's progress",
            dailyGoal: "🎯 Daily goal",
            weeklyReview: "📈 Weekly review",
            smartTip: "🧠 Smart tip",
            milestones: "🏆 Milestones",
            planTomorrow: "🌙 Plan tomorrow",
            calendar: "📅 Calendar",
            notes: "Quick Notes",
            taskPlaceholder: "What needs to get done?",
            searchPlaceholder: "Search tasks, schedule, or notes...",
            tomorrowPlaceholder: "What should happen tomorrow?",
            eventPlaceholder: "What's happening?",
            notesPlaceholder: "Write anything...",
            morning: "Good morning ☀️",
            afternoon: "Good afternoon 🌤️",
            evening: "Good evening 🌙",
            goalComplete: "Goal complete for today 🎉",
            taskLeft: "task left to reach today's goal.",
            tasksLeft: "tasks left to reach today's goal.",
            completeFirstWeek: "Complete your first task this week to start the review.",
            noMatches: "No matches found.",
            nothingPlanned: "Nothing planned for this day.",
            items: "items",
            item: "item",
            archived: "Archived",
            dueToday: "Due today",
            overdue: "Overdue"
        },
        lt: {
            "cloudSync": "Debesų sinchronizacija",
            "cloudSyncDesc": "Sinchronizuok šiuos Today duomenis tarp savo įrenginių",
            "cloudLocalOnly": "Tik šiame įrenginyje",
            "cloudOnlineOnly": "Debesų sinchronizacija veikia internetinėje HTTPS versijoje",
            "cloudReady": "Sinchronizuota",
            "cloudSyncing": "Sinchronizuojama…",
            "cloudChecking": "Tikrinamas debesis…",
            "cloudError": "Sinchronizacija nepasiekiama",
            "cloudNeedsStorage": "Debesų saugykla dar neprijungta",
            "cloudCreate": "Sukurti sinchronizaciją",
            "cloudConnect": "Prijungti kodą",
            "cloudSyncNow": "Sinchronizuoti dabar",
            "cloudDisconnect": "Atjungti",
            "cloudCodeLabel": "Tavo sinchronizacijos kodas",
            "cloudCopy": "Kopijuoti",
            "cloudCopied": "Nukopijuota",
            "cloudPrivacy": "Planavimo duomenys užšifruojami naršyklėje prieš juos įkeliant. Saugok sinchronizacijos kodą.",
            "cloudEnterCode": "Įvesk Today sinchronizacijos kodą",
            "cloudInvalidCode": "Šis sinchronizacijos kodas netinkamas.",
            "cloudCodeNotFound": "Neradau duomenų pagal šį sinchronizacijos kodą.",
            "cloudConnectConfirm": "Šio įrenginio Today duomenys bus pakeisti debesies kopija. Tęsti?",
            "cloudDisconnectConfirm": "Atjungti šį įrenginį nuo debesų sinchronizacijos? Vietiniai duomenys liks čia.",
            "cloudCreatedMessage": "Debesų sinchronizacija paruošta. Nukopijuok kodą ir įvesk jį kitame įrenginyje.",
            "cloudSetupNeeded": "Cloud Sync kodas įdiegtas, bet prie šio projekto dar reikia prijungti Vercel Blob saugyklą.",
            "cloudDecryptionError": "Šiuo kodu nepavyko iššifruoti debesies kopijos.",
            "cloudUpdatedFromOtherDevice": "Atnaujinta iš kito įrenginio",

            "previewTask": "Užduotis",
            "previewEvent": "Įvykis",
            "previewToday": "Šiandien",
            "previewTomorrow": "Rytoj",
            "previewProject": "Projektas: {project}",
            "previewTime": "Laikas: {time}",
            "previewDate": "Data: {date}",
            "previewPriority": "{priority} prioritetas",
            "noteSaving": "Saugoma…",
            "noteSaved": "Išsaugota",
            "emptyTasks": "Nėra užduočių pagal šiuos filtrus.",
            "emptySchedule": "Šiai dienai įvykių nėra.",
            "shortcutQuickAdd": "Spausk / ir pereik į greitą pridėjimą",

            "guideSetting": "Gidas",
            "guideSettingDesc": "Sužinok, ką daro kiekviena Today dalis",
            "startGuide": "Pradėti gidą",
            "guideBack": "Atgal",
            "guideNext": "Toliau",
            "guideFinish": "Baigti",
            "guideSkip": "Praleisti gidą",
            "guideClose": "Uždaryti gidą",
            "guideStep": "{current} / {total}",
            "tourQuickTitle": "Greitas pridėjimas",
            "tourQuickText": "Greičiausias būdas ką nors pridėti. Pasirink Užduotį arba Įvykį ir rašyk paprastai. Today iš teksto gali suprasti datą, prioritetą, projektą ir įvykio laiką.",
            "tourQuickExample": "Užduotis: Matematika rytoj aukštas @Mokykla\nĮvykis: Odontologas rytoj 15:30",
            "tourFocusTitle": "Svarbiausi 3",
            "tourFocusText": "Pažymėk iki trijų svarbiausių šiandienos užduočių. Jos liks atskirame trumpame sąraše.",
            "tourTemplatesTitle": "Šablonai",
            "tourTemplatesText": "Vienu paspaudimu sukuriama paruošta rutina. Šias užduotis gali redaguoti, atlikti, archyvuoti ar perkelti kaip įprastas.",
            "tourStatsTitle": "Tikslai ir progresas",
            "tourStatsText": "Čia matysi seriją, atliktas užduotis, dienos tikslą, savaitės istoriją, išmanius patarimus ir pasiekimus.",
            "tourReminderTitle": "Priminimų centras",
            "tourReminderText": "Čia surenkama tai, kam reikia dėmesio: šiandienos terminai, būsimi priminimai ir pavėluotos užduotys.",
            "tourTaskTitle": "Pilni užduoties valdikliai",
            "tourTaskText": "Naudok šią dalį, kai nori daugiau tikslumo. Nustatyk pavadinimą, prioritetą, datą, projektą, kartojimą ir priminimo laiką.",
            "tourSearchTitle": "Paieška ir filtrai",
            "tourSearchText": "Ieškok užduotyse, tvarkaraštyje ir dienos pastabose. Filtrai susiaurina užduočių sąrašą, o Projekto meniu parodo pasirinktą kategoriją.",
            "tourTomorrowTitle": "Rytojus ir vakaro užbaigimas",
            "tourTomorrowText": "Iš anksto suplanuok rytojų. Vakaro užbaigimas leidžia peržiūrėti dieną arba perkelti neatliktas užduotis.",
            "tourCalendarTitle": "Kalendorius",
            "tourCalendarText": "Perjunk Savaitės ir Mėnesio vaizdus. Pasirink datą, pamatyk jos dienotvarkę ir naudok + Užduotis arba + Įvykis.",
            "tourScheduleTitle": "Tvarkaraštis",
            "tourScheduleText": "Įvykiai turi laiką ir datą, gali kartotis kasdien, kas savaitę arba pasirinktu intervalu.",
            "tourNotesTitle": "Dienos pastaba",
            "tourNotesText": "Kiekviena kalendoriaus data turi savo pastabą. Pasirinkus kitą dieną automatiškai atidaroma tos dienos pastaba.",
            "tourSettingsTitle": "Tema, kalba, atsarginės kopijos ir programėlės valdymas",
            "tourSettingsText": "Nustatymuose yra šviesus/tamsus režimas, spalvos, pranešimai, diegimas, versijos tikrinimas, atsarginės kopijos, kalba ir šis gidas.",

            "project": "Projektas",
            "allProjects": "Visi projektai",
            "inboxProject": "Gautieji",
            "newProjectPrompt": "Projekto pavadinimas",
            "projectExists": "Toks projektas jau yra.",
            "dailyNote": "Dienos pastaba",
            "notesPlaceholder": "Rašyk ką nors šiai dienai...",
            "smartQuickHint": "Pvz.: Matematikos namų darbai rytoj aukštas @Mokykla",
            "eventRepeat": "Kartojimas",
            "scheduleType": "Tvarkaraštis",
            "taskTypeLabel": "Užduotis",
            "doneStatus": "Atlikta",
            "openStatus": "Neatlikta",
            "priorityWord": "prioritetas",

            "versionSetting": "Programėlės versija",
            "versionSettingDesc": "Patikrink, ar yra naujesnė Today versija",
            "checkUpdate": "Tikrinti",
            "checkingUpdate": "Tikrinami atnaujinimai…",
            "upToDate": "Today yra naujausios versijos.",
            "updateCheckUnavailable": "Atnaujinimų tikrinimas veikia per talpinamą arba Live Server versiją.",
            "updateReadyTitle": "Yra atnaujinimas",
            "updateReadyText": "Paruošta naujesnė Today versija.",
            "updateLater": "Vėliau",
            "updateRefresh": "Atnaujinti",
            "migrationNote": "Perkeli Today į naują interneto adresą? Pirmiausia eksportuok atsarginę kopiją — naršyklės duomenys tarp adresų automatiškai nepersikelia.",
            "offlineStatus": "Nėra interneto — Today vis tiek gali naudoti išsaugotus vietinius duomenis.",
            "onlineStatus": "Internetas vėl veikia.",

            "focusTitle": "⭐ Svarbiausi 3",
            "focusSubtitle": "Pasirink iki trijų svarbiausių šiandienos užduočių.",
            "focusEmpty": "Pažymėk užduotis žvaigždute ir sudaryk šiandienos trejetuką.",
            "focusLimit": "Šiandien jau pasirinktos trys svarbiausios užduotys.",
            "focusAdded": "Pridėta prie šiandienos svarbiausių.",
            "focusRemoved": "Pašalinta iš šiandienos svarbiausių.",
            "focusDone": "Atlikta",
            "focusOpen": "Neatlikta",
            "addToFocus": "Pridėti prie šiandienos svarbiausių 3",
            "removeFromFocus": "Pašalinti iš šiandienos svarbiausių 3",

            "previousMonth": "Ankstesnis mėnuo",
            "nextMonth": "Kitas mėnuo",
            "agendaAddTask": "+ Užduotis",
            "agendaAddEvent": "+ Įvykis",
            "calendarTaskCount": "{count} užduot.",
            "calendarEventCount": "{count} įvyk.",

            "streakLabel": "🔥 Serija",
            "completedTodayLabel": "✅ Atlikta šiandien",
            "lastSevenDaysLabel": "📅 Paskutinės 7 dienos",
            "templateCheckHomework": "Patikrinti namų darbus",
            "templatePackSchoolBag": "Susidėti mokyklinę kuprinę",
            "templatePrepareTomorrow": "Pasiruošti rytojui",
            "templateReviewTodayPlan": "Peržiūrėti šiandienos planą",
            "templateImportantTask": "Atlikti vieną svarbią užduotį",
            "templateRoomReset": "Greitai susitvarkyti kambarį",
            "templateTidyWorkspace": "Susitvarkyti darbo vietą",
            "templateReviewUnfinished": "Peržiūrėti neatliktas užduotis",
            "templatePlanNextWeek": "Suplanuoti kitą savaitę",

            "templates": "🧩 Šablonai",
            "templatesSubtitle": "Vienu paspaudimu pridėk paruoštą rutiną.",
            "schoolTemplate": "🎒 Mokyklos diena",
            "schoolTemplateDesc": "Namų darbai, kuprinės patikra ir pasiruošimas rytojui.",
            "morningTemplate": "☀️ Produktyvus rytas",
            "morningTemplateDesc": "Paprasta dienos pradžios rutina.",
            "resetTemplate": "🧹 Savaitgalio atsinaujinimas",
            "resetTemplateDesc": "Susitvarkyk, peržiūrėk savaitę ir pasiruošk kitai.",
            "templateAdded": "Rutina pridėta šiandienai.",
            "weekView": "Savaitė",
            "monthView": "Mėnuo",
            "installToday": "Įdiegti Today",
            "installTodayDesc": "Naudok Today kaip programėlę savo įrenginyje",
            "installCardTitle": "Pridėk Today prie įrenginio",
            "installAvailable": "Įdiek Today tiesiai iš šios naršyklės.",
            "installIos": "iPhone: atidaryk Today per Safari, spausk Share, tada Add to Home Screen.",
            "installUnavailable": "Ši naršyklė šiuo metu nesiūlo tiesioginio įdiegimo.",
            "install": "Įdiegti",
            "onboardWelcomeTitle": "Sveiki atvykę į Today",
            "onboardWelcomeText": "Keli greiti pasirinkimai padės pritaikyti programėlę sau.",
            "onboardLanguage": "Kalba",
            "onboardGoalTitle": "Nusistatyk dienos tikslą",
            "onboardGoalText": "Pasirink realų užduočių skaičių, kurį norėtum atlikti įprastą dieną.",
            "onboardGoalLabel": "Užduotys per dieną",
            "onboardStyleTitle": "Pasirink stilių",
            "onboardStyleText": "Pasirink akcento spalvą. Ją visada galėsi pakeisti nustatymuose.",
            "onboardAccent": "Akcento spalva",
            "skip": "Praleisti",
            "next": "Toliau",
            "finish": "Baigti",

            "quickAdd": "⚡ Greitas pridėjimas",
            "quickAddHint": "Greitai pridėk užduotį ar įvykį neatidarydamas papildomų laukų.",
            "quickAddPlaceholder": "Pridėti užduotį ar įvykį...",
            "quickAddedTask": "Užduotis pridėta šiandienai.",
            "quickAddedEvent": "Įvykis pridėtas į šiandienos tvarkaraštį.",
            "quickNeedTime": "Pasirink įvykio laiką.",
            "quickNeedText": "Pirmiausia ką nors įrašyk.",
            "reminderCenter": "🔔 Priminimų centras",
            "reminderCenterSubtitle": "Kas dabar svarbiausia.",
            "dueTodayCenter": "Terminas šiandien",
            "upcomingReminders": "Artėjantys priminimai",
            "overdueCenter": "Pavėluota",
            "noReminderItems": "Šiuo metu nieko skubaus.",
            "reminderAt": "Priminimas {time}",
            "eveningReset": "🌙 Vakaro užbaigimas",
            "eveningResetSubtitle": "Užbaik šiandieną ir palengvink rytojų.",
            "unfinishedToday": "Šiandien dar liko {count} neatliktų užduočių.",
            "allWrapped": "Šiandienos atviros užduotys užbaigtos.",
            "moveUnfinished": "Perkelti neatliktas",
            "planTomorrowAction": "Planuoti rytojų",
            "reviewToday": "Peržiūrėti šiandieną",
            "movedTomorrow": "Į rytojų perkelta {count} neatliktų užduočių.",
            "nothingToMove": "Nėra neatliktų užduočių, kurias reikėtų perkelti.",
            "taskType": "Užduotis",
            "eventType": "Įvykis",

            "add": "Pridėti",
            "save": "Išsaugoti",
            "cancel": "Atšaukti",
            "saveChanges": "Išsaugoti pakeitimus",
            "editTask": "Redaguoti užduotį",
            "editEvent": "Redaguoti įvykį",
            "task": "Užduotis",
            "priority": "Prioritetas",
            "dueDate": "Terminas",
            "repeat": "Kartojimas",
            "reminderTime": "Priminimo laikas",
            "every": "Kas",
            "unit": "Vienetas",
            "event": "Įvykis",
            "time": "Laikas",
            "date": "Data",
            "low": "Žemas",
            "medium": "Vidutinis",
            "high": "Aukštas",
            "noRepeat": "Nekartoti",
            "daily": "Kasdien",
            "weekly": "Kas savaitę",
            "custom": "Pasirinktinis",
            "days": "Dienos",
            "weeks": "Savaitės",
            "repeatEvery": "Kartoti kas",
            "all": "Visos",
            "today": "Šiandien",
            "upcoming": "Artėjančios",
            "active": "Aktyvios",
            "completed": "Atliktos",
            "highPriority": "Aukštas prioritetas",
            "archiveFilter": "Archyvuotos",
            "archiveCompleted": "Archyvuoti atliktas",
            "archiveHint": "Atliktas užduotis galima archyvuoti vietoje ištrynimo.",
            "dismiss": "Uždaryti",
            "view": "Peržiūrėti",
            "moveToday": "Perkelti į šiandien",
            "overdueReview": "Peržiūrėk jas arba perkelk į šiandien.",
            "planTomorrowHelp": "Rytojaus užduotys automatiškai pasirodys skiltyje Šiandien, kai pasikeis data.",
            "agenda": "Dienotvarkė",
            "schedule": "Tvarkaraštis",
            "todaySchedule": "Šiandienos tvarkaraštis",
            "previousWeek": "Ankstesnė savaitė",
            "nextWeek": "Kita savaitė",
            "completedLabel": "Atlikta",
            "activeDays": "Aktyvios dienos",
            "bestDay": "Geriausia diena",
            "last7Days": "Paskutinės 7 dienos",
            "completedTasks": "Atliktos užduotys",
            "target": "Tikslas",
            "enable": "Įjungti",
            "export": "Eksportuoti",
            "import": "Importuoti",
            "browserNotificationsUnavailable": "Naršyklės pranešimai: nepasiekiami",
            "browserNotificationsEnabled": "Naršyklės pranešimai: įjungti",
            "browserNotificationsBlocked": "Naršyklės pranešimai: užblokuoti",
            "browserNotificationsOptional": "Naršyklės pranešimai: neprivalomi",
            "reminder": "Priminimas",
            "due": "Terminas",
            "firstStep": "Pirmas žingsnis",
            "firstStepDesc": "Atlik pirmą užduotį",
            "momentum": "Įsibėgėjimas",
            "momentumDesc": "Atlik 10 užduočių",
            "threeDayStreak": "3 dienų serija",
            "threeDayStreakDesc": "Būk aktyvus 3 dienas",
            "fiftyClub": "Penkiasdešimtukas",
            "fiftyClubDesc": "Atlik 50 užduočių",
            "weekStreak": "Savaitės serija",
            "weekStreakDesc": "Pasiek 7 dienų seriją",
            "unlocked": "Atrakinta",
            "unlockedCount": "{done} / {total} atrakinta",
            "day": "diena",
            "daysLower": "dienos",
            "weekShort": "sav.",
            "dayShort": "d.",
            "streakDays": "{count} diena",
            "streakDaysPlural": "{count} dienos",
            "weeklyMore": "Šią savaitę kol kas atlikta {count} daugiau nei praėjusią.",
            "weeklyFewer": "Šią savaitę kol kas atlikta {count} mažiau nei praėjusią.",
            "weeklyLevel": "Kol kas rezultatas toks pats kaip praėjusią savaitę.",
            "tipOverdue": "Turi {count} pavėluotų užduočių. Pirmiausia sutvarkius vieną, likusi diena gali būti lengvesnė.",
            "tipHigh": "Šiandien turi {count} aukšto prioriteto užduočių. Apsvarstyk galimybę pradėti nuo vienos iš jų.",
            "tipGoal": "Iki šiandienos tikslo liko {count} užduočių.",
            "tipBestDay": "Pagal išsaugotą istoriją, {day} šiuo metu yra produktyviausia tavo diena.",
            "tipLearning": "Naudok Today dar kelias aktyvias dienas ir čia pradės matytis tavo įpročiai.",
            "goalCelebration": "🎉 Dienos tikslas pasiektas!",
            "weatherClear": "Giedra",
            "weatherPartly": "Debesuota su pragiedruliais",
            "weatherFog": "Rūkas",
            "weatherRain": "Lietus",
            "weatherSnow": "Sniegas",
            "weatherShowers": "Trumpalaikis lietus",
            "weatherStorm": "Perkūnija",
            "weatherUnavailable": "Orai nepasiekiami",

            settings: "Nustatymai",
            appearance: "Išvaizda",
            appearanceDesc: "Perjungti šviesų ir tamsų režimą",
            accent: "Akcento spalva",
            accentDesc: "Pritaikyk mygtukų ir progreso spalvą",
            reminders: "Priminimai",
            remindersDesc: "Priminimai programoje veikia automatiškai",
            data: "Duomenys",
            dataDesc: "Sukurk atsarginę kopiją arba atkurk Today duomenis",
            language: "Kalba",
            languageDesc: "Pasirink Today kalbą",
            dailyMessage: "Dienos žinutė",
            progress: "Šiandienos progresas",
            dailyGoal: "🎯 Dienos tikslas",
            weeklyReview: "📈 Savaitės apžvalga",
            smartTip: "🧠 Išmanus patarimas",
            milestones: "🏆 Pasiekimai",
            planTomorrow: "🌙 Suplanuok rytojų",
            calendar: "📅 Kalendorius",
            notes: "Greitos pastabos",
            taskPlaceholder: "Ką reikia padaryti?",
            searchPlaceholder: "Ieškoti užduočių, tvarkaraščio ar pastabų...",
            tomorrowPlaceholder: "Ką reikia padaryti rytoj?",
            eventPlaceholder: "Kas vyks?",
            notesPlaceholder: "Rašyk čia...",
            morning: "Labas rytas ☀️",
            afternoon: "Laba diena 🌤️",
            evening: "Labas vakaras 🌙",
            goalComplete: "Šiandienos tikslas pasiektas 🎉",
            taskLeft: "užduotis liko iki šiandienos tikslo.",
            tasksLeft: "užduotys liko iki šiandienos tikslo.",
            completeFirstWeek: "Atlik pirmą šios savaitės užduotį, kad pradėtum apžvalgą.",
            noMatches: "Nieko nerasta.",
            nothingPlanned: "Šiai dienai nieko nesuplanuota.",
            items: "įrašai",
            item: "įrašas",
            archived: "Archyvuota",
            dueToday: "Terminas šiandien",
            overdue: "Pavėluota"
        },
        es: {
            "cloudSync": "Sincronización en la nube",
            "cloudSyncDesc": "Mantén estos datos de Today sincronizados entre tus dispositivos",
            "cloudLocalOnly": "Solo local",
            "cloudOnlineOnly": "La sincronización funciona en la versión HTTPS en línea",
            "cloudReady": "Sincronizado",
            "cloudSyncing": "Sincronizando…",
            "cloudChecking": "Comprobando la nube…",
            "cloudError": "Sincronización no disponible",
            "cloudNeedsStorage": "El almacenamiento en la nube aún no está conectado",
            "cloudCreate": "Crear sincronización",
            "cloudConnect": "Conectar código",
            "cloudSyncNow": "Sincronizar ahora",
            "cloudDisconnect": "Desconectar",
            "cloudCodeLabel": "Tu código de sincronización",
            "cloudCopy": "Copiar",
            "cloudCopied": "Copiado",
            "cloudPrivacy": "Tus datos se cifran en el navegador antes de subirse. Mantén privado el código de sincronización.",
            "cloudEnterCode": "Introduce tu código de sincronización de Today",
            "cloudInvalidCode": "Ese código de sincronización no es válido.",
            "cloudCodeNotFound": "No encontré datos para ese código de sincronización.",
            "cloudConnectConfirm": "Esto sustituirá los datos de Today de este dispositivo por la copia de la nube. ¿Continuar?",
            "cloudDisconnectConfirm": "¿Desconectar este dispositivo de la nube? Tus datos locales permanecerán aquí.",
            "cloudCreatedMessage": "La sincronización está lista. Copia este código e introdúcelo en tu otro dispositivo.",
            "cloudSetupNeeded": "Cloud Sync está instalado, pero todavía hay que conectar Vercel Blob a este proyecto.",
            "cloudDecryptionError": "Ese código no pudo descifrar la copia de la nube.",
            "cloudUpdatedFromOtherDevice": "Actualizado desde otro dispositivo",

            "previewTask": "Tarea",
            "previewEvent": "Evento",
            "previewToday": "Hoy",
            "previewTomorrow": "Mañana",
            "previewProject": "Proyecto: {project}",
            "previewTime": "Hora: {time}",
            "previewDate": "Fecha: {date}",
            "previewPriority": "prioridad {priority}",
            "noteSaving": "Guardando…",
            "noteSaved": "Guardado",
            "emptyTasks": "No hay tareas que coincidan con estos filtros.",
            "emptySchedule": "No hay eventos para este día.",
            "shortcutQuickAdd": "Pulsa / para ir a Añadir rápido",

            "guideSetting": "Guía",
            "guideSettingDesc": "Aprende qué hace cada parte de Today",
            "startGuide": "Iniciar guía",
            "guideBack": "Atrás",
            "guideNext": "Siguiente",
            "guideFinish": "Terminar",
            "guideSkip": "Saltar guía",
            "guideClose": "Cerrar guía",
            "guideStep": "{current} / {total}",
            "tourQuickTitle": "Añadir rápido",
            "tourQuickText": "La forma más rápida de añadir algo. Elige Tarea o Evento y escribe normalmente. Today puede extraer fechas, prioridad, proyecto y hora del evento.",
            "tourQuickExample": "Tarea: Matemáticas mañana alta @Escuela\nEvento: Dentista mañana 15:30",
            "tourFocusTitle": "Enfoque 3",
            "tourFocusText": "Marca hasta tres tareas importantes para hoy. Se quedan en una lista corta para que no se pierdan entre muchas tareas.",
            "tourTemplatesTitle": "Plantillas",
            "tourTemplatesText": "Un toque crea una rutina preparada. Después puedes editar, completar, archivar o mover esas tareas como cualquier otra.",
            "tourStatsTitle": "Metas y progreso",
            "tourStatsText": "Aquí ves la racha, tareas completadas, meta diaria, historial semanal, consejos y logros.",
            "tourReminderTitle": "Centro de recordatorios",
            "tourReminderText": "Reúne lo que necesita atención: tareas para hoy, próximos recordatorios y tareas atrasadas.",
            "tourTaskTitle": "Controles completos de tarea",
            "tourTaskText": "Úsalo cuando quieras precisión. Define nombre, prioridad, fecha, proyecto, repetición y hora de recordatorio antes de Añadir.",
            "tourSearchTitle": "Búsqueda y filtros",
            "tourSearchText": "Busca entre tareas, eventos y notas diarias. Los filtros reducen la lista y el menú Proyecto muestra una categoría concreta.",
            "tourTomorrowTitle": "Mañana y cierre del día",
            "tourTomorrowText": "Planifica mañana con tiempo. El cierre del día permite revisar hoy o mover tareas pendientes.",
            "tourCalendarTitle": "Calendario",
            "tourCalendarText": "Cambia entre Semana y Mes. Elige una fecha para ver su agenda y usa + Tarea o + Evento para preparar algo para ese día.",
            "tourScheduleTitle": "Horario",
            "tourScheduleText": "Los eventos tienen hora y fecha y pueden repetirse a diario, semanalmente o con un intervalo personalizado.",
            "tourNotesTitle": "Nota diaria",
            "tourNotesText": "Cada fecha del calendario tiene su propia nota. Elegir otro día cambia automáticamente a la nota de esa fecha.",
            "tourSettingsTitle": "Tema, idioma, copias y controles de la app",
            "tourSettingsText": "Ajustes incluye modo claro/oscuro, colores, notificaciones, instalación, comprobación de versión, copias, idioma y esta guía.",

            "project": "Proyecto",
            "allProjects": "Todos los proyectos",
            "inboxProject": "Bandeja",
            "newProjectPrompt": "Nombre del proyecto",
            "projectExists": "Ese proyecto ya existe.",
            "dailyNote": "Nota diaria",
            "notesPlaceholder": "Escribe algo para este día...",
            "smartQuickHint": "Prueba: Matemáticas mañana alta @Escuela",
            "eventRepeat": "Repetir",
            "scheduleType": "Horario",
            "taskTypeLabel": "Tarea",
            "doneStatus": "Hecha",
            "openStatus": "Pendiente",
            "priorityWord": "prioridad",

            "versionSetting": "Versión de la app",
            "versionSettingDesc": "Comprueba si hay una versión más reciente de Today",
            "checkUpdate": "Comprobar",
            "checkingUpdate": "Buscando actualizaciones…",
            "upToDate": "Today está actualizado.",
            "updateCheckUnavailable": "La búsqueda de actualizaciones funciona en la versión alojada o con Live Server.",
            "updateReadyTitle": "Actualización disponible",
            "updateReadyText": "Hay una versión más reciente de Today lista.",
            "updateLater": "Más tarde",
            "updateRefresh": "Actualizar",
            "migrationNote": "¿Vas a mover Today a otra dirección web? Exporta primero una copia de seguridad: los datos del navegador no se trasladan automáticamente entre direcciones.",
            "offlineStatus": "Sin conexión — Today puede seguir usando los datos locales guardados.",
            "onlineStatus": "Conexión restaurada.",

            "focusTitle": "⭐ Enfoque 3",
            "focusSubtitle": "Elige hasta tres cosas que más importan hoy.",
            "focusEmpty": "Marca tareas con una estrella para crear tu enfoque de hoy.",
            "focusLimit": "Ya tienes tres tareas de enfoque para hoy.",
            "focusAdded": "Añadida al enfoque de hoy.",
            "focusRemoved": "Eliminada del enfoque de hoy.",
            "focusDone": "Hecha",
            "focusOpen": "Pendiente",
            "addToFocus": "Añadir al Enfoque 3 de hoy",
            "removeFromFocus": "Quitar del Enfoque 3 de hoy",

            "previousMonth": "Mes anterior",
            "nextMonth": "Mes siguiente",
            "agendaAddTask": "+ Tarea",
            "agendaAddEvent": "+ Evento",
            "calendarTaskCount": "{count} tarea{suffix}",
            "calendarEventCount": "{count} evento{suffix}",

            "streakLabel": "🔥 Racha",
            "completedTodayLabel": "✅ Completadas hoy",
            "lastSevenDaysLabel": "📅 Últimos 7 días",
            "templateCheckHomework": "Revisar los deberes",
            "templatePackSchoolBag": "Preparar la mochila",
            "templatePrepareTomorrow": "Prepararse para mañana",
            "templateReviewTodayPlan": "Revisar el plan de hoy",
            "templateImportantTask": "Completar una tarea importante",
            "templateRoomReset": "Orden rápido de la habitación",
            "templateTidyWorkspace": "Ordenar el espacio de trabajo",
            "templateReviewUnfinished": "Revisar tareas pendientes",
            "templatePlanNextWeek": "Planificar la próxima semana",

            "templates": "🧩 Plantillas",
            "templatesSubtitle": "Añade una rutina preparada con un toque.",
            "schoolTemplate": "🎒 Día de estudio",
            "schoolTemplateDesc": "Tareas, mochila y preparación para mañana.",
            "morningTemplate": "☀️ Mañana productiva",
            "morningTemplateDesc": "Una rutina sencilla para empezar el día.",
            "resetTemplate": "🧹 Reinicio de fin de semana",
            "resetTemplateDesc": "Ordena, revisa y prepárate para la semana.",
            "templateAdded": "Rutina añadida para hoy.",
            "weekView": "Semana",
            "monthView": "Mes",
            "installToday": "Instalar Today",
            "installTodayDesc": "Usa Today como una app en tu dispositivo",
            "installCardTitle": "Añade Today a tu dispositivo",
            "installAvailable": "Instala Today directamente desde este navegador.",
            "installIos": "En iPhone: abre Today en Safari, toca Compartir y luego Añadir a pantalla de inicio.",
            "installUnavailable": "Este navegador no ofrece instalación directa en este momento.",
            "install": "Instalar",
            "onboardWelcomeTitle": "Bienvenido a Today",
            "onboardWelcomeText": "Unas opciones rápidas harán que la app se sienta más tuya.",
            "onboardLanguage": "Idioma",
            "onboardGoalTitle": "Define una meta diaria",
            "onboardGoalText": "Elige una cantidad realista de tareas para un día normal.",
            "onboardGoalLabel": "Tareas por día",
            "onboardStyleTitle": "Elige tu estilo",
            "onboardStyleText": "Elige un color de acento. Puedes cambiarlo cuando quieras.",
            "onboardAccent": "Color de acento",
            "skip": "Saltar",
            "next": "Siguiente",
            "finish": "Terminar",

            "quickAdd": "⚡ Añadir rápido",
            "quickAddHint": "Añade algo sin abrir controles extra.",
            "quickAddPlaceholder": "Añade una tarea o evento...",
            "quickAddedTask": "Tarea añadida para hoy.",
            "quickAddedEvent": "Evento añadido al horario de hoy.",
            "quickNeedTime": "Elige una hora para el evento.",
            "quickNeedText": "Escribe algo primero.",
            "reminderCenter": "🔔 Centro de recordatorios",
            "reminderCenterSubtitle": "Lo que necesita tu atención ahora.",
            "dueTodayCenter": "Para hoy",
            "upcomingReminders": "Próximos recordatorios",
            "overdueCenter": "Atrasadas",
            "noReminderItems": "Nada urgente ahora mismo.",
            "reminderAt": "Recordatorio a las {time}",
            "eveningReset": "🌙 Cierre del día",
            "eveningResetSubtitle": "Cierra hoy y haz que mañana sea más fácil.",
            "unfinishedToday": "Todavía tienes {count} tareas sin terminar para hoy.",
            "allWrapped": "Las tareas abiertas de hoy están listas.",
            "moveUnfinished": "Mover pendientes",
            "planTomorrowAction": "Planificar mañana",
            "reviewToday": "Revisar hoy",
            "movedTomorrow": "Se movieron {count} tareas pendientes a mañana.",
            "nothingToMove": "No hay tareas pendientes para mover.",
            "taskType": "Tarea",
            "eventType": "Evento",

            "add": "Añadir",
            "save": "Guardar",
            "cancel": "Cancelar",
            "saveChanges": "Guardar cambios",
            "editTask": "Editar tarea",
            "editEvent": "Editar evento",
            "task": "Tarea",
            "priority": "Prioridad",
            "dueDate": "Fecha límite",
            "repeat": "Repetir",
            "reminderTime": "Hora del recordatorio",
            "every": "Cada",
            "unit": "Unidad",
            "event": "Evento",
            "time": "Hora",
            "date": "Fecha",
            "low": "Baja",
            "medium": "Media",
            "high": "Alta",
            "noRepeat": "No repetir",
            "daily": "Diario",
            "weekly": "Semanal",
            "custom": "Personalizado",
            "days": "Días",
            "weeks": "Semanas",
            "repeatEvery": "Repetir cada",
            "all": "Todas",
            "today": "Hoy",
            "upcoming": "Próximas",
            "active": "Activas",
            "completed": "Completadas",
            "highPriority": "Prioridad alta",
            "archiveFilter": "Archivadas",
            "archiveCompleted": "Archivar completadas",
            "archiveHint": "Las tareas completadas pueden archivarse en vez de borrarse.",
            "dismiss": "Cerrar",
            "view": "Ver",
            "moveToday": "Mover a hoy",
            "overdueReview": "Revísalas o muévelas a hoy.",
            "planTomorrowHelp": "Las tareas de mañana aparecerán automáticamente en Hoy cuando cambie la fecha.",
            "agenda": "Agenda",
            "schedule": "Horario",
            "todaySchedule": "Horario de hoy",
            "previousWeek": "Semana anterior",
            "nextWeek": "Semana siguiente",
            "completedLabel": "Completadas",
            "activeDays": "Días activos",
            "bestDay": "Mejor día",
            "last7Days": "Últimos 7 días",
            "completedTasks": "Tareas completadas",
            "target": "Meta",
            "enable": "Activar",
            "export": "Exportar",
            "import": "Importar",
            "browserNotificationsUnavailable": "Notificaciones del navegador: no disponibles",
            "browserNotificationsEnabled": "Notificaciones del navegador: activadas",
            "browserNotificationsBlocked": "Notificaciones del navegador: bloqueadas",
            "browserNotificationsOptional": "Notificaciones del navegador: opcionales",
            "reminder": "Recordatorio",
            "due": "Vence",
            "firstStep": "Primer paso",
            "firstStepDesc": "Completa tu primera tarea",
            "momentum": "Impulso",
            "momentumDesc": "Completa 10 tareas",
            "threeDayStreak": "Racha de 3 días",
            "threeDayStreakDesc": "Mantente activo 3 días",
            "fiftyClub": "Club de 50",
            "fiftyClubDesc": "Completa 50 tareas",
            "weekStreak": "Racha semanal",
            "weekStreakDesc": "Alcanza una racha de 7 días",
            "unlocked": "Desbloqueado",
            "unlockedCount": "{done} / {total} desbloqueados",
            "day": "día",
            "daysLower": "días",
            "weekShort": "sem.",
            "dayShort": "día",
            "streakDays": "{count} día",
            "streakDaysPlural": "{count} días",
            "weeklyMore": "{count} más completadas que la semana pasada hasta ahora.",
            "weeklyFewer": "{count} menos completadas que la semana pasada hasta ahora.",
            "weeklyLevel": "Vas igual que el total de la semana pasada hasta ahora.",
            "tipOverdue": "Tienes {count} tareas atrasadas. Resolver una primero puede hacer que el resto del día se sienta más ligero.",
            "tipHigh": "Tienes {count} tareas de prioridad alta para hoy. Considera hacer una antes que las de prioridad menor.",
            "tipGoal": "Te faltan {count} tareas para alcanzar la meta de hoy.",
            "tipBestDay": "Según tu historial guardado, {day} es actualmente tu día con más tareas completadas.",
            "tipLearning": "Usa Today unos días activos más y aquí empezarán a aparecer tus patrones.",
            "goalCelebration": "🎉 ¡Meta diaria completada!",
            "weatherClear": "Despejado",
            "weatherPartly": "Parcialmente nublado",
            "weatherFog": "Niebla",
            "weatherRain": "Lluvia",
            "weatherSnow": "Nieve",
            "weatherShowers": "Chubascos",
            "weatherStorm": "Tormenta",
            "weatherUnavailable": "Tiempo no disponible",

            settings: "Ajustes",
            appearance: "Apariencia",
            appearanceDesc: "Cambia entre modo claro y oscuro",
            accent: "Color de acento",
            accentDesc: "Personaliza botones y progreso",
            reminders: "Recordatorios",
            remindersDesc: "Los recordatorios internos funcionan automáticamente",
            data: "Datos",
            dataDesc: "Haz una copia o restaura tus datos de Today",
            language: "Idioma",
            languageDesc: "Elige el idioma de Today",
            dailyMessage: "Mensaje del día",
            progress: "Progreso de hoy",
            dailyGoal: "🎯 Meta diaria",
            weeklyReview: "📈 Resumen semanal",            smartTip: "🧠 Consejo inteligente",
            milestones: "🏆 Logros",
            planTomorrow: "🌙 Planifica mañana",
            calendar: "📅 Calendario",
            notes: "Notas rápidas",
            taskPlaceholder: "¿Qué necesitas hacer?",
            searchPlaceholder: "Buscar tareas, agenda o notas...",
            tomorrowPlaceholder: "¿Qué debería pasar mañana?",
            eventPlaceholder: "¿Qué está pasando?",
            notesPlaceholder: "Escribe lo que quieras...",
            morning: "Buenos días ☀️",
            afternoon: "Buenas tardes 🌤️",
            evening: "Buenas noches 🌙",
            goalComplete: "Meta de hoy completada 🎉",
            taskLeft: "tarea para alcanzar la meta de hoy.",
            tasksLeft: "tareas para alcanzar la meta de hoy.",
            completeFirstWeek: "Completa tu primera tarea de la semana para iniciar el resumen.",
            noMatches: "No se encontraron resultados.",
            nothingPlanned: "No hay nada planeado para este día.",
            items: "elementos",
            item: "elemento",
            archived: "Archivada",
            dueToday: "Para hoy",
            overdue: "Atrasada"
        }
    };

    const dailyMessages = {
        en: [
            "Small progress is still progress.",
            "Pick one important thing and make it easier for future you.",
            "You do not need a perfect day to have a good one.",
            "Finish what matters most, then let the rest be lighter.",
            "A calm plan beats a crowded mind.",
            "One completed task can change the direction of the whole day.",
            "Make today useful, not impossible.",
            "Consistency grows from ordinary days like this one.",
            "Do the next clear thing. You can decide the rest after.",
            "Leave a little less for tomorrow than you started with today.",
            "Progress counts even when it feels small.",
            "A short focused session is better than waiting for perfect motivation.",
            "Your plan can change. Your direction can stay.",
            "Make room for both progress and rest.",
            "Start with the task that will make the rest feel easier.",
            "You only need to move the day forward, not finish everything.",
            "Good systems make hard days simpler.",
            "Future you will notice the work you do today.",
            "A realistic plan is stronger than an overloaded one.",
            "Keep it simple: choose, start, finish, repeat."
        ],
        lt: [
            "Mažas progresas vis tiek yra progresas.",
            "Pasirink vieną svarbų dalyką ir palengvink gyvenimą būsimam sau.",
            "Diena neprivalo būti tobula, kad būtų gera.",
            "Pirmiausia užbaik tai, kas svarbiausia, o visa kita tegul būna lengviau.",
            "Ramus planas geriau už perpildytą galvą.",
            "Viena atlikta užduotis gali pakeisti visos dienos kryptį.",
            "Padaryk šiandieną naudingą, o ne neįmanomą.",
            "Pastovumas auga iš paprastų dienų kaip ši.",
            "Padaryk kitą aiškų žingsnį. Visa kita nuspręsi vėliau.",
            "Palik rytojui šiek tiek mažiau, nei turėjai šiandien.",
            "Progresas svarbus net tada, kai atrodo mažas.",
            "Trumpas susikaupimas geriau nei laukimas tobulos motyvacijos.",
            "Planas gali keistis, bet kryptis gali likti ta pati.",
            "Palik vietos ir progresui, ir poilsiui.",
            "Pradėk nuo užduoties, kuri palengvins visa kita.",
            "Tau nereikia padaryti visko — tik pastumti dieną į priekį.",
            "Geros sistemos palengvina sunkias dienas.",
            "Būsimasis tu pastebės darbą, kurį padarei šiandien.",
            "Realistiškas planas stipresnis už perpildytą.",
            "Paprastai: pasirink, pradėk, užbaik, pakartok."
        ],
        es: [
            "Un pequeño progreso sigue siendo progreso.",
            "Elige una cosa importante y hazle la vida más fácil a tu yo futuro.",
            "No necesitas un día perfecto para tener un buen día.",
            "Termina primero lo que más importa y deja que el resto sea más ligero.",
            "Un plan tranquilo vence a una mente saturada.",
            "Una tarea terminada puede cambiar la dirección de todo el día.",
            "Haz que hoy sea útil, no imposible.",
            "La constancia crece en días normales como este.",
            "Haz la siguiente cosa clara. Decide el resto después.",
            "Deja un poco menos para mañana de lo que tenías hoy.",
            "El progreso cuenta aunque parezca pequeño.",
            "Una sesión corta y enfocada es mejor que esperar motivación perfecta.",
            "Tu plan puede cambiar. Tu dirección puede mantenerse.",
            "Deja espacio para avanzar y también para descansar.",
            "Empieza por la tarea que hará que lo demás se sienta más fácil.",
            "No necesitas terminarlo todo; solo mover el día hacia adelante.",
            "Los buenos sistemas simplifican los días difíciles.",
            "Tu yo futuro notará el trabajo que haces hoy.",
            "Un plan realista es más fuerte que uno sobrecargado.",
            "Hazlo simple: elige, empieza, termina, repite."
        ]
    };

    function t(key) {
        return translations[appLanguage]?.[key] ?? translations.en[key] ?? key;
    }

    function tr(key, variables = {}) {
        let value = String(t(key));

        Object.entries(variables).forEach(([name, replacement]) => {
            value = value.replaceAll(`{${name}}`, String(replacement));
        });

        return value;
    }

    function getAppLocale() {
        return {
            en: "en-US",
            lt: "lt-LT",
            es: "es-ES"
        }[appLanguage] || "en-US";
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function setLanguage(language) {
        const allowed = ["en", "lt", "es"];
        appLanguage = allowed.includes(language) ? language : "en";
        safeStorageSet("appLanguage", appLanguage);

        document.documentElement.lang = appLanguage;

        const selector = document.getElementById("languageSelect");
        if (selector) selector.value = appLanguage;

        applyTranslations();
    }

    function applyTranslations() {
        setText("settingsTitle", t("settings"));
        setText("appearanceSettingTitle", t("appearance"));
        setText("appearanceSettingDescription", t("appearanceDesc"));
        setText("accentSettingTitle", t("accent"));
        setText("accentSettingDescription", t("accentDesc"));
        setText("remindersSettingTitle", t("reminders"));
        setText("remindersSettingDescription", t("remindersDesc"));
        setText("dataSettingTitle", t("data"));
        setText("dataSettingDescription", t("dataDesc"));
        setText("cloudSyncTitle", t("cloudSync"));
        setText("cloudSyncDescription", t("cloudSyncDesc"));
        setText("cloudSyncCodeLabel", t("cloudCodeLabel"));
        setText("cloudCreateButton", t("cloudCreate"));
        setText("cloudConnectButton", t("cloudConnect"));
        setText("cloudSyncNowButton", t("cloudSyncNow"));
        setText("cloudDisconnectButton", t("cloudDisconnect"));
        setText("cloudCopyButton", t("cloudCopy"));
        setText("cloudSyncPrivacy", t("cloudPrivacy"));
        setText("languageSettingTitle", t("language"));
        setText("languageSettingDescription", t("languageDesc"));
        setText("guideSettingTitle", t("guideSetting"));
        setText("guideSettingDescription", t("guideSettingDesc"));
        setText("startGuideButton", t("startGuide"));
        setText("controlTourBackButton", t("guideBack"));
        setText("controlTourSkipButton", t("guideSkip"));
        document.getElementById("controlTourCloseButton")?.setAttribute("aria-label", t("guideClose"));
        setText("dailyMessageLabel", t("dailyMessage"));
        setText("progressLabel", t("progress"));
        setText("dailyGoalTitle", t("dailyGoal"));
        setText("weeklyReviewTitle", t("weeklyReview"));
        setText("smartTipTitle", t("smartTip"));
        setText("milestonesTitle", t("milestones"));
        setText("planTomorrowTitle", t("planTomorrow"));
        setText("calendarTitle", t("calendar"));
        setText("notesTitle", t("dailyNote"));
        setText("projectFilterLabel", t("project"));
        setText("editTaskProjectLabel", t("project"));
        setText("editEventRepeatLabel", t("eventRepeat"));
        setText("editEventEveryLabel", t("every"));
        setText("editEventUnitLabel", t("unit"));
        setText("eventRepeatEveryLabel", t("repeatEvery"));
        setText("goalCelebration", t("goalCelebration"));
        setText("quickAddTitle", t("quickAdd"));
        setText("quickAddHint", t("smartQuickHint"));
        setText("focusTitle", t("focusTitle"));
        setText("focusSubtitle", t("focusSubtitle"));
        setText("reminderCenterTitle", t("reminderCenter"));
        setText("reminderCenterSubtitle", t("reminderCenterSubtitle"));
        setText("reminderDueTodayLabel", t("dueTodayCenter"));
        setText("reminderUpcomingLabel", t("upcomingReminders"));
        setText("reminderOverdueLabel", t("overdueCenter"));
        setText("eveningResetTitle", t("eveningReset"));
        setText("eveningResetSubtitle", t("eveningResetSubtitle"));
        setText("moveUnfinishedButton", t("moveUnfinished"));
        setText("focusTomorrowButton", t("planTomorrowAction"));
        setText("reviewTodayButton", t("reviewToday"));
        setText("quickAddFeedback", "");
        setText("streakLabel", t("streakLabel"));
        setText("completedTodayLabel", t("completedTodayLabel"));
        setText("lastSevenDaysLabel", t("lastSevenDaysLabel"));
        syncTemplateTaskLanguage();
        setText("templatesTitle", t("templates"));
        setText("templatesSubtitle", t("templatesSubtitle"));
        setText("schoolTemplateTitle", t("schoolTemplate"));
        setText("schoolTemplateDesc", t("schoolTemplateDesc"));
        setText("morningTemplateTitle", t("morningTemplate"));
        setText("morningTemplateDesc", t("morningTemplateDesc"));
        setText("resetTemplateTitle", t("resetTemplate"));
        setText("resetTemplateDesc", t("resetTemplateDesc"));
        setText("weekViewButton", t("weekView"));
        setText("monthViewButton", t("monthView"));
        setText("agendaAddTaskButton", t("agendaAddTask"));
        setText("agendaAddEventButton", t("agendaAddEvent"));
        setText("installSettingTitle", t("installToday"));
        setText("installSettingDescription", t("installTodayDesc"));
        setText("installCardTitle", t("installCardTitle"));
        setText("installAppButton", t("install"));
        setText("versionSettingTitle", t("versionSetting"));
        setText("versionSettingDescription", t("versionSettingDesc"));
        setText("checkUpdateButton", t("checkUpdate"));
        setText("migrationNote", t("migrationNote"));
        setText("pwaUpdateTitle", t("updateReadyTitle"));
        setText("pwaUpdateText", t("updateReadyText"));
        setText("pwaUpdateLaterButton", t("updateLater"));
        setText("pwaUpdateNowButton", t("updateRefresh"));
        updateInstallUI();
        updateOnboardingTranslations();

        const quickType = document.getElementById("quickAddType");
        if (quickType) {
            const taskOption = quickType.querySelector('option[value="task"]');
            const eventOption = quickType.querySelector('option[value="event"]');

            if (taskOption) taskOption.textContent = t("taskType");
            if (eventOption) eventOption.textContent = t("eventType");
        }

        document.querySelectorAll("[data-i18n]").forEach(element => {
            const key = element.dataset.i18n;
            element.textContent = t(key);
        });

        document.querySelectorAll("[data-i18n-placeholder]").forEach(input => {
            const key = input.dataset.i18nPlaceholder;
            input.placeholder = t(key);
        });

        updateCalendarNavigationLabels();

        updateGreeting();
        updateDate();
        updateDailyMessage();
        updateDailyGoal();
        updateWeeklyReview();
        renderGlobalSearch();
        renderCalendarWeek();
        renderDayAgenda();
        renderSchedule();
        renderTasks();
        updateNotificationStatus();
        renderReminderCenter();
        updateEveningReset();
        renderFocusThree();
        syncProjectSelects();
        syncEventRepeatTranslations();
        loadDailyNote();
        updateQuickAddType();
        updateQuickAddPreview();
        updateCloudSyncUI();

        if (document.getElementById("controlTourOverlay")?.classList.contains("open")) {
            renderControlTourStep();
        }

        getWeather();
    }

    function updateDailyMessage() {
        const target = document.getElementById("dailyMessageText");
        if (!target) return;

        const messages = dailyMessages[appLanguage] || dailyMessages.en;
        const dateKey = getDateKey();

        let hash = 0;
        for (const char of dateKey) {
            hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
        }

        const index = hash % messages.length;
        target.textContent = messages[index];
    }

    // Greeting
    function updateGreeting() {
        const hour = new Date().getHours();

        let greeting;

        if (hour < 12) {
            greeting = t("morning");
        } else if (hour < 18) {
            greeting = t("afternoon");
        } else {
            greeting = t("evening");
        }

        document.getElementById("greeting").textContent = greeting;
    }

    // Date
    function updateDate() {
        const date = new Date();

        document.getElementById("date").textContent =
            date.toLocaleDateString(getAppLocale(), {
                weekday: "long",
                month: "long",
                day: "numeric"
            });
    }

    function getDateKey(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    function getTomorrowKey() {
        const tomorrow = new Date();
        tomorrow.setHours(0, 0, 0, 0);
        tomorrow.setDate(tomorrow.getDate() + 1);
        return getDateKey(tomorrow);
    }

    function isOverdueTask(task) {
        return Boolean(
            task &&
            !task.completed &&
            task.dueDate &&
            getDueDateStatus(task.dueDate) === "overdue"
        );
    }

    function startOfWeek(date = new Date()) {
        const result = new Date(date);
        result.setHours(0, 0, 0, 0);

        const day = result.getDay();
        const distanceToMonday = day === 0 ? -6 : 1 - day;
        result.setDate(result.getDate() + distanceToMonday);

        return result;
    }

    function getActivityTotalBetween(startDate, endDate) {
        let total = 0;
        const cursor = new Date(startDate);
        cursor.setHours(0, 0, 0, 0);

        const end = new Date(endDate);
        end.setHours(0, 0, 0, 0);

        while (cursor <= end) {
            total += activityHistory[getDateKey(cursor)] || 0;
            cursor.setDate(cursor.getDate() + 1);
        }

        return total;
    }

    function saveActivityHistory() {
        safeStorageSet("activityHistory", JSON.stringify(activityHistory));
    }

    function recordCompletion(task) {
        const today = getDateKey();

        if (task.completedOn === today) return;

        task.completedOn = today;
        activityHistory[today] = (activityHistory[today] || 0) + 1;

        saveActivityHistory();
    }

    function undoCompletion(task) {
        if (!task.completedOn) return;

        const dateKey = task.completedOn;

        if (activityHistory[dateKey]) {
            activityHistory[dateKey] = Math.max(0, activityHistory[dateKey] - 1);

            if (activityHistory[dateKey] === 0) {
                delete activityHistory[dateKey];
            }
        }

        task.completedOn = "";
        saveActivityHistory();
    }

    function getCurrentStreak() {
        let cursor = new Date();
        cursor.setHours(0, 0, 0, 0);

        const todayKey = getDateKey(cursor);

        if (!activityHistory[todayKey]) {
            cursor.setDate(cursor.getDate() - 1);
        }

        let streak = 0;

        while (activityHistory[getDateKey(cursor)] > 0) {
            streak++;
            cursor.setDate(cursor.getDate() - 1);
        }

        return streak;
    }

    function getLast7DaysTotal() {
        let total = 0;
        const cursor = new Date();
        cursor.setHours(0, 0, 0, 0);

        for (let i = 0; i < 7; i++) {
            total += activityHistory[getDateKey(cursor)] || 0;
            cursor.setDate(cursor.getDate() - 1);
        }

        return total;
    }

    function updateStats() {
        const todayCount = activityHistory[getDateKey()] || 0;
        const streak = getCurrentStreak();
        const weekTotal = getLast7DaysTotal();

        const streakStat = document.getElementById("streakStat");
        const todayStat = document.getElementById("todayStat");
        const weekStat = document.getElementById("weekStat");

        if (streakStat) {
            streakStat.textContent =
                streak === 1
                    ? tr("streakDays", { count: streak })
                    : tr("streakDaysPlural", { count: streak });
        }

        if (todayStat) {
            todayStat.textContent = todayCount;
        }

        if (weekStat) {
            weekStat.textContent = weekTotal;
        }

        updateDailyGoal();
        updateWeeklyReview();
        renderHistoryBars();
        updateSmartTip();
        updateAchievements();
    }

    function saveDailyGoal() {
        const input = document.getElementById("dailyGoalInput");
        const value = Math.min(50, Math.max(1, Number(input.value) || 1));

        dailyGoal = value;
        input.value = value;
        safeStorageSet("dailyGoal", String(dailyGoal));

        updateDailyGoal();
    }

    function updateDailyGoal() {
        const completedToday = activityHistory[getDateKey()] || 0;
        const percentage = Math.min(100, (completedToday / dailyGoal) * 100);

        const input = document.getElementById("dailyGoalInput");
        const count = document.getElementById("dailyGoalCount");
        const bar = document.getElementById("dailyGoalBar");
        const message = document.getElementById("goalMessage");

        if (input) input.value = dailyGoal;
        if (count) count.textContent = `${completedToday} / ${dailyGoal}`;
        if (bar) bar.style.width = percentage + "%";

        if (message) {
            if (completedToday >= dailyGoal) {
                message.textContent = t("goalComplete");
                maybeCelebrateDailyGoal(completedToday);
            } else {
                const remaining = dailyGoal - completedToday;
                message.textContent =
                    `${remaining} ${remaining === 1 ? t("taskLeft") : t("tasksLeft")}`;
            }
        }
    }

    function updateWeeklyReview() {
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        const weekStart = startOfWeek(now);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);

        const previousWeekStart = new Date(weekStart);
        previousWeekStart.setDate(previousWeekStart.getDate() - 7);

        const previousWeekEnd = new Date(weekStart);
        previousWeekEnd.setDate(previousWeekEnd.getDate() - 1);

        const completed = getActivityTotalBetween(weekStart, now);
        const previousCompleted = getActivityTotalBetween(previousWeekStart, previousWeekEnd);

        let activeDays = 0;
        let bestCount = 0;
        let bestDate = null;

        const cursor = new Date(weekStart);

        while (cursor <= now) {
            const count = activityHistory[getDateKey(cursor)] || 0;

            if (count > 0) activeDays++;

            if (count > bestCount) {
                bestCount = count;
                bestDate = new Date(cursor);
            }

            cursor.setDate(cursor.getDate() + 1);
        }

        const range = document.getElementById("weeklyReviewRange");
        const completedEl = document.getElementById("weeklyCompleted");
        const activeDaysEl = document.getElementById("weeklyActiveDays");
        const bestDayEl = document.getElementById("weeklyBestDay");
        const message = document.getElementById("weeklyReviewMessage");

        const rangeStart = weekStart.toLocaleDateString(getAppLocale(), { month: "short", day: "numeric" });
        const rangeEnd = weekEnd.toLocaleDateString(getAppLocale(), { month: "short", day: "numeric" });

        if (range) range.textContent = `${rangeStart} – ${rangeEnd}`;
        if (completedEl) completedEl.textContent = completed;
        if (activeDaysEl) activeDaysEl.textContent = `${activeDays} / 7`;
        if (bestDayEl) {
            bestDayEl.textContent = bestDate
                ? `${bestDate.toLocaleDateString(getAppLocale(), { weekday: "short" })} · ${bestCount}`
                : "—";
        }

        if (message) {
            if (completed === 0) {
                message.textContent = t("completeFirstWeek");
            } else {
                const difference = completed - previousCompleted;

                if (difference > 0) {
                    message.textContent = tr("weeklyMore", { count: difference });
                } else if (difference < 0) {
                    message.textContent = tr("weeklyFewer", { count: Math.abs(difference) });
                } else {
                    message.textContent = t("weeklyLevel");
                }
            }
        }
    }

    function maybeCelebrateDailyGoal(completedToday) {
        if (completedToday < dailyGoal) return;

        const today = getDateKey();
        const celebratedDate = safeStorageGet("goalCelebratedDate");

        if (celebratedDate === today) return;

        safeStorageSet("goalCelebratedDate", today);

        const celebration = document.getElementById("goalCelebration");
        if (!celebration) return;

        celebration.classList.add("show");

        clearTimeout(window.todayGoalCelebrationTimer);
        window.todayGoalCelebrationTimer = setTimeout(() => {
            celebration.classList.remove("show");
        }, 2600);
    }

    function getLifetimeCompletedTotal() {
        return Object.values(activityHistory).reduce(
            (total, value) => total + (Number(value) || 0),
            0
        );
    }

    function renderHistoryBars() {
        const container = document.getElementById("historyBars");
        if (!container) return;

        const days = [];
        const cursor = new Date();
        cursor.setHours(0, 0, 0, 0);

        for (let offset = 6; offset >= 0; offset--) {
            const date = new Date(cursor);
            date.setDate(date.getDate() - offset);

            days.push({
                date,
                key: getDateKey(date),
                count: activityHistory[getDateKey(date)] || 0
            });
        }

        const maxCount = Math.max(1, ...days.map(day => day.count));
        const todayKey = getDateKey();

        container.innerHTML = "";

        days.forEach(day => {
            const wrapper = document.createElement("div");
            wrapper.className = "history-day";

            if (day.key === todayKey) {
                wrapper.classList.add("today");
            }

            const count = document.createElement("div");
            count.className = "history-count";
            count.textContent = day.count;

            const track = document.createElement("div");
            track.className = "history-track";

            const fill = document.createElement("div");
            fill.className = "history-fill";
            fill.style.height =
                day.count === 0 ? "3px" : `${Math.max(12, (day.count / maxCount) * 100)}%`;

            const label = document.createElement("div");
            label.className = "history-label";
            label.textContent = day.date.toLocaleDateString(getAppLocale(), {
                weekday: "short"
            });

            track.appendChild(fill);
            wrapper.appendChild(count);
            wrapper.appendChild(track);
            wrapper.appendChild(label);
            container.appendChild(wrapper);
        });
    }

    function getHistoricalBestWeekday() {
        const totals = Array(7).fill(0);
        let activeDates = 0;

        Object.entries(activityHistory).forEach(([dateKey, count]) => {
            const value = Number(count) || 0;
            if (value <= 0) return;

            const date = new Date(dateKey + "T00:00:00");
            totals[date.getDay()] += value;
            activeDates++;
        });

        if (activeDates < 3) return null;

        const bestTotal = Math.max(...totals);
        if (bestTotal <= 0) return null;

        const bestDayIndex = totals.indexOf(bestTotal);
        const sample = new Date(2026, 0, 4 + bestDayIndex);

        return sample.toLocaleDateString(getAppLocale(), { weekday: "long" });
    }

    function updateSmartTip() {
        const tip = document.getElementById("smartTipText");
        if (!tip) return;

        const overdueCount = tasks.filter(task => !task.archived && isOverdueTask(task)).length;
        const todayKey = getDateKey();
        const completedToday = activityHistory[todayKey] || 0;
        const remaining = Math.max(0, dailyGoal - completedToday);

        const highToday = tasks.filter(task =>
            !task.archived &&
            !task.completed &&
            (task.priority || "medium") === "high" &&
            task.dueDate === todayKey
        ).length;

        if (overdueCount > 0) {
            tip.textContent = tr("tipOverdue", {
                count: overdueCount,
                suffix: overdueCount === 1 ? "" : "s"
            });
            return;
        }

        if (highToday > 0) {
            tip.textContent = tr("tipHigh", {
                count: highToday,
                suffix: highToday === 1 ? "" : "s",
                verb: highToday === 1 ? "is" : "are",
                object: highToday === 1 ? "it" : "one"
            });
            return;
        }

        if (remaining > 0) {
            tip.textContent = tr("tipGoal", {
                count: remaining,
                suffix: remaining === 1 ? "" : "s"
            });
            return;
        }

        const bestWeekday = getHistoricalBestWeekday();

        if (bestWeekday) {
            tip.textContent = tr("tipBestDay", { day: bestWeekday });
            return;
        }

        tip.textContent = t("tipLearning");
    }

    function updateAchievements() {
        const list = document.getElementById("achievementList");
        const countLabel = document.getElementById("achievementsCount");

        if (!list || !countLabel) return;

        const totalCompleted = getLifetimeCompletedTotal();
        const streak = getCurrentStreak();

        const achievements = [
            {
                icon: "✅",
                name: t("firstStep"),
                detail: t("firstStepDesc"),
                unlocked: totalCompleted >= 1
            },
            {
                icon: "⚡",
                name: t("momentum"),
                detail: t("momentumDesc"),
                unlocked: totalCompleted >= 10
            },
            {
                icon: "🔥",
                name: t("threeDayStreak"),
                detail: t("threeDayStreakDesc"),
                unlocked: streak >= 3
            },
            {
                icon: "🏅",
                name: t("fiftyClub"),
                detail: t("fiftyClubDesc"),
                unlocked: totalCompleted >= 50
            },
            {
                icon: "👑",
                name: t("weekStreak"),
                detail: t("weekStreakDesc"),
                unlocked: streak >= 7
            }
        ];

        const unlockedCount = achievements.filter(item => item.unlocked).length;
        countLabel.textContent = tr("unlockedCount", {
            done: unlockedCount,
            total: achievements.length
        });

        list.innerHTML = "";

        achievements.forEach(item => {
            const achievement = document.createElement("div");
            achievement.className = "achievement";

            if (!item.unlocked) {
                achievement.classList.add("locked");
            }

            const icon = document.createElement("div");
            icon.className = "achievement-icon";
            icon.textContent = item.unlocked ? item.icon : "🔒";

            const copy = document.createElement("div");
            copy.className = "achievement-copy";

            const name = document.createElement("strong");
            name.textContent = item.name;

            const detail = document.createElement("span");
            detail.textContent = item.unlocked ? t("unlocked") : item.detail;

            copy.appendChild(name);
            copy.appendChild(detail);

            achievement.appendChild(icon);
            achievement.appendChild(copy);

            list.appendChild(achievement);
        });
    }

    function formatDueDate(dateString) {
        if (!dateString) return "";

        const date = new Date(dateString + "T00:00:00");
        return date.toLocaleDateString(getAppLocale(), {
            month: "short",
            day: "numeric"
        });
    }

    function getDueDateStatus(dateString) {
        if (!dateString) return "";

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const due = new Date(dateString + "T00:00:00");

        if (due.getTime() < today.getTime()) return "overdue";
        if (due.getTime() === today.getTime()) return "today";

        return "";
    }

    function isDueToday(dateString) {
        if (!dateString) return false;
        return getDueDateStatus(dateString) === "today";
    }

    function isUpcoming(dateString) {
        if (!dateString) return false;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const due = new Date(dateString + "T00:00:00");

        return due.getTime() > today.getTime();
    }

    function toggleCustomRepeat() {
        const repeat = document.getElementById("repeatInput").value;
        const controls = document.getElementById("customRepeatControls");

        controls.classList.toggle("show", repeat === "custom");
    }

    function addDaysToDate(dateString, days) {
        const base = dateString
            ? new Date(dateString + "T00:00:00")
            : new Date();

        base.setHours(0, 0, 0, 0);
        base.setDate(base.getDate() + days);

        const year = base.getFullYear();
        const month = String(base.getMonth() + 1).padStart(2, "0");
        const day = String(base.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    function createNextRecurringTask(task) {
        if (!task.repeat || task.repeat === "none") return;
        if (task.recurrenceGenerated) return;

        let daysToAdd = 1;

        if (task.repeat === "weekly") {
            daysToAdd = 7;
        } else if (task.repeat === "custom") {
            const amount = Math.max(1, Number(task.repeatEvery) || 1);
            daysToAdd = task.repeatUnit === "weeks" ? amount * 7 : amount;
        }

        const nextDueDate = addDaysToDate(task.dueDate, daysToAdd);

        tasks.push({
            id: createLocalId("task"),
            text: task.text,
            completed: false,
            priority: task.priority || "medium",
            dueDate: nextDueDate,
            project: task.project || "",
            repeat: task.repeat,
            repeatEvery: task.repeatEvery || 1,
            repeatUnit: task.repeatUnit || "days",
            reminderTime: task.reminderTime || "",
            archived: false,
            recurrenceGenerated: false,
            generatedFromId: task.id,
            focusDate: ""
        });

        task.recurrenceGenerated = true;
    }

    function undoRecurringGeneration(task) {
        if (!task?.recurrenceGenerated) return;

        const childIndex = tasks.findIndex(candidate =>
            candidate.generatedFromId === task.id
        );

        if (childIndex === -1) {
            // Older recurring tasks did not store a parent link. Resetting the
            // flag here preserves the old behavior without guessing which task
            // should be deleted.
            task.recurrenceGenerated = false;
            return;
        }

        const child = tasks[childIndex];

        if (!child.completed && !child.archived) {
            tasks.splice(childIndex, 1);
            task.recurrenceGenerated = false;
        }
        // If the generated child has already been completed or archived, keep
        // the parent flag set so re-completing the parent cannot create a duplicate.
    }

    const legacyTemplateTextKeys = {
        "Check homework": "templateCheckHomework",
        "Pack school bag": "templatePackSchoolBag",
        "Prepare for tomorrow": "templatePrepareTomorrow",
        "Review today's plan": "templateReviewTodayPlan",
        "Complete one important task": "templateImportantTask",
        "Quick room reset": "templateRoomReset",
        "Tidy workspace": "templateTidyWorkspace",
        "Review unfinished tasks": "templateReviewUnfinished",
        "Plan the next week": "templatePlanNextWeek"
    };

    function syncTemplateTaskLanguage() {
        let changed = false;

        tasks.forEach(task => {
            if (!task.templateItemKey && legacyTemplateTextKeys[task.text]) {
                task.templateItemKey = legacyTemplateTextKeys[task.text];
                changed = true;
            }

            if (task.templateItemKey && translations.en[task.templateItemKey]) {
                const translatedText = t(task.templateItemKey);

                if (task.text !== translatedText) {
                    task.text = translatedText;
                    changed = true;
                }
            }
        });

        if (changed) {
            safeStorageSet("tasks", JSON.stringify(tasks));
        }
    }

    function applyTemplate(name) {
        const today = getDateKey();

        const templates = {
            school: [
                { textKey: "templateCheckHomework", priority: "high" },
                { textKey: "templatePackSchoolBag", priority: "medium" },
                { textKey: "templatePrepareTomorrow", priority: "medium" }
            ],
            morning: [
                { textKey: "templateReviewTodayPlan", priority: "high" },
                { textKey: "templateImportantTask", priority: "high" },
                { textKey: "templateRoomReset", priority: "low" }
            ],
            reset: [
                { textKey: "templateTidyWorkspace", priority: "medium" },
                { textKey: "templateReviewUnfinished", priority: "high" },
                { textKey: "templatePlanNextWeek", priority: "medium" }
            ]
        };

        const selected = templates[name];
        if (!selected) return;

        selected.forEach(item => {
            tasks.push({
                id: createLocalId("task"),                text: t(item.textKey),
                templateItemKey: item.textKey,
                completed: false,
                priority: item.priority,
                dueDate: today,
                project: name === "school" ? "School" : "Personal",
                repeat: "none",
                repeatEvery: 1,
                repeatUnit: "days",
                reminderTime: "",
                archived: false,
                recurrenceGenerated: false,
                generatedFromId: "",
                focusDate: "",
                completedOn: ""
            });
        });

        saveTasks();
        renderTasks();

        const feedback = document.getElementById("quickAddFeedback");
        if (feedback) feedback.textContent = t("templateAdded");
    }

    function saveProjects() {
        safeStorageSet("projects", JSON.stringify(projects));
    }

    function fillProjectSelect(select, includeAll = false) {
        if (!select) return;

        const previous = select.value;
        select.innerHTML = "";

        const base = document.createElement("option");
        base.value = includeAll ? "all" : "";
        base.textContent = includeAll ? t("allProjects") : t("inboxProject");
        select.appendChild(base);

        projects.forEach(project => {
            const option = document.createElement("option");
            option.value = project;
            option.textContent = project;
            select.appendChild(option);
        });

        const fallback = includeAll ? "all" : "";
        select.value = [...select.options].some(option => option.value === previous)
            ? previous
            : fallback;
    }

    function syncProjectSelects() {
        fillProjectSelect(document.getElementById("projectInput"));
        fillProjectSelect(document.getElementById("editTaskProject"));
        fillProjectSelect(document.getElementById("projectFilter"), true);

        const filter = document.getElementById("projectFilter");
        if (filter) {
            filter.value = [...filter.options].some(option => option.value === currentProjectFilter)
                ? currentProjectFilter
                : "all";
        }
    }

    function addProjectPrompt() {
        const name = prompt(t("newProjectPrompt"));
        if (name === null) return;

        const clean = name.trim();
        if (!clean) return;

        const existing = projects.find(
            project => project.toLowerCase() === clean.toLowerCase()
        );

        if (existing) {
            alert(t("projectExists"));
            syncProjectSelects();
            const input = document.getElementById("projectInput");
            if (input) input.value = existing;
            return;
        }

        projects.push(clean);
        projects.sort((a, b) => a.localeCompare(b));
        saveProjects();
        syncProjectSelects();

        const input = document.getElementById("projectInput");
        if (input) input.value = clean;
    }

    function ensureProject(name) {
        const clean = String(name || "").trim();
        if (!clean) return "";

        const existing = projects.find(
            project => project.toLowerCase() === clean.toLowerCase()
        );

        if (existing) return existing;

        projects.push(clean);
        projects.sort((a, b) => a.localeCompare(b));
        saveProjects();
        syncProjectSelects();
        return clean;
    }

    function setProjectFilter(value) {
        currentProjectFilter = value || "all";
        safeStorageSet("projectFilter", currentProjectFilter);
        renderTasks();
    }

    function addDaysToDateKey(dateKey, days) {
        const date = parseDateKey(dateKey);
        date.setDate(date.getDate() + Number(days || 0));
        return getDateKey(date);
    }

    function parseSmartQuickAdd(raw, type, commitProject = false) {
        let text = String(raw || "").trim();
        let date = getDateKey();
        let priority = "medium";
        let project = "";
        let time = "";

        [
            { pattern: /\b(tomorrow|rytoj|mañana)\b/iu, offset: 1 },
            { pattern: /\b(today|šiandien|siandien|hoy)\b/iu, offset: 0 }
        ].forEach(term => {
            if (term.pattern.test(text)) {
                date = addDaysToDateKey(getDateKey(), term.offset);
                text = text.replace(term.pattern, " ");
            }
        });

        const explicitDate = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
        if (explicitDate) {
            date = explicitDate[1];
            text = text.replace(explicitDate[0], " ");
        }

        [
            { pattern: /\b(high|aukštas|aukstas|alta)\b/iu, value: "high" },
            { pattern: /\b(low|žemas|zemas|baja)\b/iu, value: "low" },
            { pattern: /\b(medium|vidutinis|media)\b/iu, value: "medium" }
        ].forEach(term => {
            if (term.pattern.test(text)) {
                priority = term.value;
                text = text.replace(term.pattern, " ");
            }
        });

        const projectMatch = text.match(/@([\p{L}\p{N}_-]+)/u);
        if (projectMatch) {
            const rawProject = projectMatch[1].replaceAll("_", " ");
            project = commitProject ? ensureProject(rawProject) : rawProject;
            text = text.replace(projectMatch[0], " ");
        }

        const timeMatch = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
        if (timeMatch) {
            time = `${String(Number(timeMatch[1])).padStart(2, "0")}:${timeMatch[2]}`;
            text = text.replace(timeMatch[0], " ");
        }

        text = text
            .replace(/\s+/g, " ")
            .replace(/^[,;:\-\s]+|[,;:\-\s]+$/g, "")
            .trim();

        return { text, date, priority, project, time, type };
    }

    function getQuickAddDateLabel(dateKey) {
        if (dateKey === getDateKey()) return t("previewToday");
        if (dateKey === getTomorrowKey()) return t("previewTomorrow");
        return formatDueDate(dateKey);
    }

    function updateQuickAddPreview() {
        const preview = document.getElementById("quickAddPreview");
        const input = document.getElementById("quickAddInput");
        const type = document.getElementById("quickAddType")?.value || "task";
        const fallbackTime = document.getElementById("quickAddTime")?.value || "";

        if (!preview || !input) return;

        const raw = input.value.trim();
        preview.innerHTML = "";

        if (!raw) return;

        const parsed = parseSmartQuickAdd(raw, type, false);
        if (!parsed.text) return;

        const chips = [];

        chips.push({
            text: type === "event" ? t("previewEvent") : t("previewTask"),
            primary: true
        });

        chips.push({
            text: getQuickAddDateLabel(parsed.date),
            primary: false
        });

        if (type === "task") {
            chips.push({
                text: tr("previewPriority", { priority: t(parsed.priority) }),
                primary: false
            });
        }

        if (parsed.project) {
            chips.push({
                text: tr("previewProject", { project: parsed.project }),
                primary: false
            });
        }

        if (type === "event") {
            const eventTime = parsed.time || fallbackTime;
            if (eventTime) {
                chips.push({
                    text: tr("previewTime", { time: eventTime }),
                    primary: false
                });
            }
        }

        chips.forEach(chip => {
            const element = document.createElement("span");
            element.className = `quick-preview-chip${chip.primary ? " primary" : ""}`;
            element.textContent = chip.text;
            preview.appendChild(element);
        });
    }

    function getDefaultQuickEventTime() {
        const now = new Date();
        const next = new Date(now);

        next.setMinutes(0, 0, 0);
        next.setHours(next.getHours() + 1);

        return `${String(next.getHours()).padStart(2, "0")}:00`;
    }

    function updateQuickAddType() {
        const type = document.getElementById("quickAddType")?.value || "task";
        const time = document.getElementById("quickAddTime");

        if (!time) return;

        time.classList.toggle("show", type === "event");

        if (type === "event" && !time.value) {
            time.value = getDefaultQuickEventTime();
        }

        updateQuickAddPreview();
    }

    function handleQuickAddEnter(event) {
        if (event.key === "Enter") {
            quickAddItem();
        }
    }

    function quickAddItem() {
        const input = document.getElementById("quickAddInput");
        const type = document.getElementById("quickAddType")?.value || "task";
        const timeInput = document.getElementById("quickAddTime");
        const feedback = document.getElementById("quickAddFeedback");

        const raw = input?.value.trim() || "";

        if (!raw) {
            if (feedback) feedback.textContent = t("quickNeedText");
            input?.focus();
            return;
        }

        const parsed = parseSmartQuickAdd(raw, type, true);

        if (!parsed.text) {
            if (feedback) feedback.textContent = t("quickNeedText");
            return;
        }

        if (type === "event") {
            const time = parsed.time || timeInput?.value || "";

            if (!time) {
                if (feedback) feedback.textContent = t("quickNeedTime");
                timeInput?.focus();
                return;
            }

            events.push({
                id: createLocalId("event"),
                name: parsed.text,
                time,
                date: parsed.date,
                repeat: "none",
                repeatEvery: 1,
                repeatUnit: "days"
            });

            sortEvents();
            saveEvents();
            selectedCalendarDate = parsed.date;
            safeStorageSet("selectedCalendarDate", selectedCalendarDate);

            renderSchedule();
            renderCalendarWeek();
            renderDayAgenda();
            loadDailyNote();

            if (feedback) feedback.textContent = t("quickAddedEvent");
        } else {
            tasks.push({
                id: createLocalId("task"),
                text: parsed.text,
                completed: false,
                priority: parsed.priority,
                dueDate: parsed.date,
                project: parsed.project,
                repeat: "none",
                repeatEvery: 1,
                repeatUnit: "days",
                reminderTime: "",
                archived: false,
                recurrenceGenerated: false,
                generatedFromId: "",
                focusDate: "",
                completedOn: ""
            });

            saveTasks();
            renderTasks();

            if (feedback) feedback.textContent = t("quickAddedTask");
        }

        if (input) {
            input.value = "";
            input.focus();
        }

        updateQuickAddPreview();
        renderGlobalSearch();
        renderReminderCenter();
        updateEveningReset();
    }

    function clearGlobalSearch() {
        const input = document.getElementById("globalSearchInput");
        const results = document.getElementById("searchResults");

        if (input) input.value = "";
        if (results) {
            results.innerHTML = "";
            results.classList.remove("show");
        }
    }

    function getSearchSnippet(text, query, maxLength = 90) {
        const clean = String(text || "").replace(/\s+/g, " ").trim();
        const lower = clean.toLowerCase();
        const index = lower.indexOf(query.toLowerCase());

        if (index === -1) return clean.slice(0, maxLength);

        const start = Math.max(0, index - 28);
        const end = Math.min(clean.length, start + maxLength);
        const prefix = start > 0 ? "…" : "";
        const suffix = end < clean.length ? "…" : "";

        return prefix + clean.slice(start, end) + suffix;
    }

    function renderGlobalSearch() {
        const input = document.getElementById("globalSearchInput");
        const results = document.getElementById("searchResults");

        if (!input || !results) return;

        const query = input.value.trim().toLowerCase();

        if (!query) {
            results.innerHTML = "";
            results.classList.remove("show");
            return;
        }

        const matches = [];

        tasks.forEach(task => {
            if (String(task.text || "").toLowerCase().includes(query)) {
                matches.push({
                    type: task.archived ? "Archived task" : "Task",
                    title: task.text,
                    detail: [
                        task.project || "",
                        task.dueDate ? `${t("due")} ${formatDueDate(task.dueDate)}` : "",
                        task.priority ? `${t(task.priority)} ${t("priorityWord")}` : ""
                    ].filter(Boolean).join(" · ")
                });
            }
        });

        events.forEach(event => {
            if (String(event.name || "").toLowerCase().includes(query)) {
                matches.push({
                    type: "Schedule",
                    title: event.name,
                    detail: [
                        event.date ? formatDueDate(event.date) : "",
                        event.time || "",
                        getEventRepeatLabel(event) ? `↻ ${getEventRepeatLabel(event)}` : ""
                    ].filter(Boolean).join(" · ")
                });
            }
        });

        Object.entries(dailyNotes).forEach(([dateKey, notesText]) => {
            if (String(notesText || "").toLowerCase().includes(query)) {
                matches.push({
                    type: t("dailyNote"),
                    title: formatDueDate(dateKey),
                    detail: getSearchSnippet(notesText, query)
                });
            }
        });

        results.innerHTML = "";
        results.classList.add("show");

        if (matches.length === 0) {
            const empty = document.createElement("div");
            empty.className = "search-result";
            empty.textContent = t("noMatches");
            results.appendChild(empty);
            return;
        }

        matches.slice(0, 12).forEach(match => {
            const row = document.createElement("div");
            row.className = "search-result";

            const top = document.createElement("div");
            top.className = "search-result-top";

            const title = document.createElement("div");
            title.className = "search-result-title";
            title.textContent = match.title;

            const type = document.createElement("span");
            type.className = "search-result-type";
            type.textContent = match.type;

            top.appendChild(title);
            top.appendChild(type);
            row.appendChild(top);

            if (match.detail) {
                const detail = document.createElement("div");
                detail.className = "search-result-detail";
                detail.textContent = match.detail;
                row.appendChild(detail);
            }

            results.appendChild(row);
        });
    }


    /* Today Cloud Sync v1
       - The sync code never leaves the browser.
       - The server receives a SHA-256 sync ID + AES-GCM encrypted payload.
       - A background loop checks for local/remote changes.
    */

    const TODAY_CLOUD_API = "/api/sync";
    const TODAY_CLOUD_CODE_KEY = "todayCloudSyncCode";
    const TODAY_CLOUD_DEVICE_KEY = "todayCloudDeviceId";
    const TODAY_CLOUD_LAST_SYNCED_KEY = "todayCloudLastSyncedFingerprint";
    const TODAY_CLOUD_LAST_REMOTE_KEY = "todayCloudLastRemoteUpdatedAt";
    const TODAY_CLOUD_LOCAL_CHANGED_KEY = "todayCloudLocalChangedAt";

    let cloudSyncInFlight = false;
    let cloudSyncTimer = null;
    let cloudSyncLastSeenFingerprint = "";
    let cloudSyncStorageUnavailable = false;

    function cloudSyncSupportedHere() {
        return (
            location.protocol === "https:" ||
            location.hostname === "localhost" ||
            location.hostname === "127.0.0.1"
        );
    }

    function getCloudDeviceId() {
        let id = safeStorageGet(TODAY_CLOUD_DEVICE_KEY);

        if (!id) {
            id = createLocalId("device");
            safeStorageSet(TODAY_CLOUD_DEVICE_KEY, id);
        }

        return id;
    }

    function normalizeCloudCode(code) {
        return String(code || "")
            .toUpperCase()
            .replace(/[^A-Z2-9]/g, "");
    }

    function formatCloudCode(code) {
        const clean = normalizeCloudCode(code);
        return clean.match(/.{1,5}/g)?.join("-") || clean;
    }

    function generateCloudCode() {
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        const bytes = new Uint8Array(25);
        crypto.getRandomValues(bytes);

        let value = "";

        bytes.forEach(byte => {
            value += alphabet[byte % alphabet.length];
        });

        return formatCloudCode(value);
    }

    function bytesToBase64(bytes) {
        let binary = "";
        bytes.forEach(byte => {
            binary += String.fromCharCode(byte);
        });
        return btoa(binary);
    }

    function base64ToBytes(value) {
        const binary = atob(value);
        const bytes = new Uint8Array(binary.length);

        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }

        return bytes;
    }

    function bytesToHex(bytes) {
        return [...bytes]
            .map(byte => byte.toString(16).padStart(2, "0"))
            .join("");
    }

    async function sha256Bytes(text) {
        return new Uint8Array(
            await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(text)
            )
        );
    }

    async function getCloudSyncId(code) {
        const digest = await sha256Bytes(
            `today-sync-id-v1:${normalizeCloudCode(code)}`
        );

        return bytesToHex(digest).slice(0, 48);
    }

    async function getCloudEncryptionKey(code) {
        const normalized = normalizeCloudCode(code);

        const rawKey = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(normalized),
            "PBKDF2",
            false,
            ["deriveKey"]
        );

        const saltDigest = await sha256Bytes(
            `today-sync-salt-v1:${normalized}`
        );

        return crypto.subtle.deriveKey(
            {
                name: "PBKDF2",
                salt: saltDigest.slice(0, 16),
                iterations: 180000,
                hash: "SHA-256"
            },
            rawKey,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    }

    function buildCloudSnapshot() {
        return {
            schemaVersion: TODAY_DATA_VERSION,
            tasks,
            events,
            projects,
            dailyNotes,
            activityHistory,
            dailyGoal,
            accentColor,
            appLanguage,
            darkMode: document.body.classList.contains("dark"),
            taskFilter: currentTaskFilter,
            projectFilter: currentProjectFilter
        };
    }

    async function cloudFingerprint(snapshot = buildCloudSnapshot()) {
        const digest = await sha256Bytes(JSON.stringify(snapshot));
        return bytesToHex(digest);
    }

    async function encryptCloudSnapshot(code, snapshot) {
        const key = await getCloudEncryptionKey(code);
        const iv = crypto.getRandomValues(new Uint8Array(12));

        const plain = new TextEncoder().encode(JSON.stringify(snapshot));

        const encrypted = new Uint8Array(
            await crypto.subtle.encrypt(
                { name: "AES-GCM", iv },
                key,
                plain
            )
        );

        return {
            version: 1,
            iv: bytesToBase64(iv),
            cipher: bytesToBase64(encrypted)
        };
    }

    async function decryptCloudSnapshot(code, encrypted) {
        const key = await getCloudEncryptionKey(code);
        const iv = base64ToBytes(encrypted.iv);
        const cipher = base64ToBytes(encrypted.cipher);

        const plain = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            key,
            cipher
        );

        return JSON.parse(new TextDecoder().decode(plain));
    }

    function setCloudSyncStatus(kind, message) {
        const status = document.getElementById("cloudSyncStatus");
        const dot = document.getElementById("cloudSyncDot");

        if (status) status.textContent = message;

        if (dot) {
            dot.classList.remove("ready", "busy", "error");

            if (kind) {
                dot.classList.add(kind);
            }
        }
    }

    function updateCloudSyncUI() {
        const code = safeStorageGet(TODAY_CLOUD_CODE_KEY) || "";
        const connected = Boolean(code);
        const supported = cloudSyncSupportedHere();

        const codeBox = document.getElementById("cloudSyncCodeBox");
        const codeText = document.getElementById("cloudSyncCodeText");
        const create = document.getElementById("cloudCreateButton");
        const connect = document.getElementById("cloudConnectButton");
        const syncNow = document.getElementById("cloudSyncNowButton");
        const disconnect = document.getElementById("cloudDisconnectButton");

        if (codeBox) codeBox.hidden = !connected;
        if (codeText) codeText.textContent = connected ? formatCloudCode(code) : "";

        if (create) create.hidden = connected;
        if (connect) connect.hidden = connected;
        if (syncNow) syncNow.hidden = !connected;
        if (disconnect) disconnect.hidden = !connected;

        if (!supported) {
            setCloudSyncStatus("", t("cloudOnlineOnly"));
            return;
        }

        if (!connected) {
            setCloudSyncStatus("", t("cloudLocalOnly"));
            return;
        }

        if (cloudSyncStorageUnavailable) {
            setCloudSyncStatus("error", t("cloudNeedsStorage"));
            return;
        }

        if (!cloudSyncInFlight) {
            setCloudSyncStatus("ready", t("cloudReady"));
        }
    }

    async function cloudApiRequest(method, syncId, payload = null) {
        const options = {
            method,
            headers: {
                "Accept": "application/json"
            },
            cache: "no-store"
        };

        let url = TODAY_CLOUD_API;

        if (method === "GET") {
            url += `?id=${encodeURIComponent(syncId)}`;
        } else {
            options.headers["Content-Type"] = "application/json";
            options.body = JSON.stringify({
                syncId,
                payload
            });
        }

        const response = await fetch(url, options);

        let body = null;

        try {
            body = await response.json();
        } catch (error) {
            body = {};
        }

        if (response.status === 503 && body?.error === "storage_not_configured") {
            cloudSyncStorageUnavailable = true;
        }

        if (!response.ok) {
            const error = new Error(body?.error || `cloud_${response.status}`);
            error.status = response.status;
            error.body = body;
            throw error;
        }

        cloudSyncStorageUnavailable = false;
        return body;
    }

    async function pushCloudSnapshot(code, snapshot = buildCloudSnapshot()) {
        const syncId = await getCloudSyncId(code);
        const fingerprint = await cloudFingerprint(snapshot);
        const encrypted = await encryptCloudSnapshot(code, snapshot);
        const updatedAt = Date.now();

        await cloudApiRequest("POST", syncId, {
            ...encrypted,
            updatedAt,
            deviceId: getCloudDeviceId(),
            schemaVersion: TODAY_DATA_VERSION
        });

        safeStorageSet(TODAY_CLOUD_LAST_SYNCED_KEY, fingerprint);
        safeStorageSet(TODAY_CLOUD_LAST_REMOTE_KEY, String(updatedAt));
        safeStorageSet(TODAY_CLOUD_LOCAL_CHANGED_KEY, String(updatedAt));

        cloudSyncLastSeenFingerprint = fingerprint;

        return { fingerprint, updatedAt };
    }

    async function fetchCloudSnapshot(code) {
        const syncId = await getCloudSyncId(code);
        const result = await cloudApiRequest("GET", syncId);

        if (!result?.payload) {
            const error = new Error("missing_payload");
            error.status = 404;
            throw error;
        }

        let snapshot;

        try {
            snapshot = await decryptCloudSnapshot(code, result.payload);
        } catch (error) {
            const decryptError = new Error("decrypt_failed");
            decryptError.cause = error;
            throw decryptError;
        }

        return {
            snapshot,
            payload: result.payload
        };
    }

    function applyCloudSnapshot(snapshot) {
        if (!snapshot || !Array.isArray(snapshot.tasks) || !Array.isArray(snapshot.events)) {
            throw new Error("invalid_snapshot");
        }

        safeStorageSet("tasks", JSON.stringify(snapshot.tasks));
        safeStorageSet("events", JSON.stringify(snapshot.events));
        safeStorageSet(
            "projects",
            JSON.stringify(Array.isArray(snapshot.projects) ? snapshot.projects : projects)
        );
        safeStorageSet(
            "dailyNotes",
            JSON.stringify(
                snapshot.dailyNotes && typeof snapshot.dailyNotes === "object"
                    ? snapshot.dailyNotes
                    : {}
            )
        );
        safeStorageSet(
            "activityHistory",
            JSON.stringify(
                snapshot.activityHistory && typeof snapshot.activityHistory === "object"
                    ? snapshot.activityHistory
                    : {}
            )
        );
        safeStorageSet(
            "dailyGoal",
            String(Math.max(1, Number(snapshot.dailyGoal) || 3))
        );
        safeStorageSet(
            "accentColor",
            String(snapshot.accentColor || "graphite")
        );
        safeStorageSet(
            "appLanguage",
            ["en", "lt", "es"].includes(snapshot.appLanguage)
                ? snapshot.appLanguage
                : appLanguage
        );
        safeStorageSet(
            "darkMode",
            snapshot.darkMode ? "true" : "false"
        );
        safeStorageSet(
            "taskFilter",
            String(snapshot.taskFilter || "all")
        );
        safeStorageSet(
            "projectFilter",
            String(snapshot.projectFilter || "all")
        );
    }

    async function createCloudSync() {
        if (!cloudSyncSupportedHere()) {
            alert(t("cloudOnlineOnly"));
            return;
        }

        if (!crypto?.subtle) {
            setCloudSyncStatus("error", t("cloudError"));
            return;
        }

        const code = generateCloudCode();
        safeStorageSet(TODAY_CLOUD_CODE_KEY, code);
        updateCloudSyncUI();

        cloudSyncInFlight = true;
        setCloudSyncStatus("busy", t("cloudSyncing"));

        try {
            await pushCloudSnapshot(code);
            alert(t("cloudCreatedMessage"));
        } catch (error) {
            if (cloudSyncStorageUnavailable) {
                alert(t("cloudSetupNeeded"));
            } else {
                console.error("Cloud sync create failed", error);
                setCloudSyncStatus("error", t("cloudError"));
            }
        } finally {
            cloudSyncInFlight = false;
            updateCloudSyncUI();
        }
    }

    async function connectCloudSync() {
        if (!cloudSyncSupportedHere()) {
            alert(t("cloudOnlineOnly"));
            return;
        }

        const entered = prompt(t("cloudEnterCode"));
        if (entered === null) return;

        const code = formatCloudCode(entered);

        if (normalizeCloudCode(code).length !== 25) {
            alert(t("cloudInvalidCode"));
            return;
        }

        cloudSyncInFlight = true;
        setCloudSyncStatus("busy", t("cloudChecking"));

        try {
            const remote = await fetchCloudSnapshot(code);

            const okay = confirm(t("cloudConnectConfirm"));
            if (!okay) return;

            safeStorageSet(TODAY_CLOUD_CODE_KEY, code);
            applyCloudSnapshot(remote.snapshot);

            const fingerprint = await cloudFingerprint(remote.snapshot);
            safeStorageSet(TODAY_CLOUD_LAST_SYNCED_KEY, fingerprint);
            safeStorageSet(
                TODAY_CLOUD_LAST_REMOTE_KEY,
                String(Number(remote.payload.updatedAt) || Date.now())
            );
            safeStorageSet(
                TODAY_CLOUD_LOCAL_CHANGED_KEY,
                String(Number(remote.payload.updatedAt) || Date.now())
            );

            location.reload();
        } catch (error) {
            if (error.message === "decrypt_failed") {
                alert(t("cloudDecryptionError"));
            } else if (error.status === 404) {
                alert(t("cloudCodeNotFound"));
            } else if (cloudSyncStorageUnavailable) {
                alert(t("cloudSetupNeeded"));
            } else {
                console.error("Cloud sync connect failed", error);
                setCloudSyncStatus("error", t("cloudError"));
            }
        } finally {
            cloudSyncInFlight = false;
            updateCloudSyncUI();
        }
    }

    async function copyCloudSyncCode() {
        const code = safeStorageGet(TODAY_CLOUD_CODE_KEY);
        if (!code) return;

        try {
            await navigator.clipboard.writeText(formatCloudCode(code));

            const button = document.getElementById("cloudCopyButton");
            if (button) {
                const previous = button.textContent;
                button.textContent = t("cloudCopied");

                setTimeout(() => {
                    button.textContent = previous || t("cloudCopy");
                }, 1200);
            }
        } catch (error) {
            prompt(t("cloudCodeLabel"), formatCloudCode(code));
        }
    }

    function disconnectCloudSync() {
        if (!confirm(t("cloudDisconnectConfirm"))) return;

        safeStorageRemove(TODAY_CLOUD_CODE_KEY);
        safeStorageRemove(TODAY_CLOUD_LAST_SYNCED_KEY);
        safeStorageRemove(TODAY_CLOUD_LAST_REMOTE_KEY);
        safeStorageRemove(TODAY_CLOUD_LOCAL_CHANGED_KEY);

        cloudSyncLastSeenFingerprint = "";
        cloudSyncStorageUnavailable = false;
        updateCloudSyncUI();
    }

    async function syncCloudNow(showErrors = false) {
        const code = safeStorageGet(TODAY_CLOUD_CODE_KEY);

        if (!code || !cloudSyncSupportedHere() || cloudSyncInFlight) {
            updateCloudSyncUI();
            return;
        }

        cloudSyncInFlight = true;
        setCloudSyncStatus("busy", t("cloudSyncing"));

        try {
            const snapshot = buildCloudSnapshot();
            const localFingerprint = await cloudFingerprint(snapshot);

            if (
                cloudSyncLastSeenFingerprint &&
                localFingerprint !== cloudSyncLastSeenFingerprint
            ) {
                safeStorageSet(
                    TODAY_CLOUD_LOCAL_CHANGED_KEY,
                    String(Date.now())
                );
            }

            cloudSyncLastSeenFingerprint = localFingerprint;

            let remote = null;

            try {
                remote = await fetchCloudSnapshot(code);
            } catch (error) {
                if (error.status === 404) {
                    await pushCloudSnapshot(code, snapshot);
                    return;
                }

                throw error;
            }

            const remoteFingerprint = await cloudFingerprint(remote.snapshot);
            const lastSynced =
                safeStorageGet(TODAY_CLOUD_LAST_SYNCED_KEY) || "";

            const remoteUpdatedAt = Number(remote.payload.updatedAt) || 0;
            const localChangedAt =
                Number(safeStorageGet(TODAY_CLOUD_LOCAL_CHANGED_KEY)) || 0;

            if (remoteFingerprint === localFingerprint) {
                safeStorageSet(
                    TODAY_CLOUD_LAST_SYNCED_KEY,
                    localFingerprint
                );
                safeStorageSet(
                    TODAY_CLOUD_LAST_REMOTE_KEY,
                    String(remoteUpdatedAt)
                );
                return;
            }

            const localChanged = localFingerprint !== lastSynced;
            const remoteChanged = remoteFingerprint !== lastSynced;

            if (remoteChanged && !localChanged) {
                applyCloudSnapshot(remote.snapshot);

                safeStorageSet(
                    TODAY_CLOUD_LAST_SYNCED_KEY,
                    remoteFingerprint
                );
                safeStorageSet(
                    TODAY_CLOUD_LAST_REMOTE_KEY,
                    String(remoteUpdatedAt)
                );
                safeStorageSet(
                    TODAY_CLOUD_LOCAL_CHANGED_KEY,
                    String(remoteUpdatedAt)
                );

                showPwaStatus(t("cloudUpdatedFromOtherDevice"), 1800);

                setTimeout(() => location.reload(), 500);
                return;
            }

            if (localChanged && !remoteChanged) {
                await pushCloudSnapshot(code, snapshot);
                return;
            }

            // Both sides changed. v1 uses last-write-wins.
            if (remoteUpdatedAt > localChangedAt) {
                applyCloudSnapshot(remote.snapshot);

                safeStorageSet(
                    TODAY_CLOUD_LAST_SYNCED_KEY,
                    remoteFingerprint
                );
                safeStorageSet(
                    TODAY_CLOUD_LAST_REMOTE_KEY,
                    String(remoteUpdatedAt)
                );
                safeStorageSet(
                    TODAY_CLOUD_LOCAL_CHANGED_KEY,
                    String(remoteUpdatedAt)
                );

                showPwaStatus(t("cloudUpdatedFromOtherDevice"), 1800);
                setTimeout(() => location.reload(), 500);
            } else {
                await pushCloudSnapshot(code, snapshot);
            }
        } catch (error) {
            if (cloudSyncStorageUnavailable) {
                if (showErrors) alert(t("cloudSetupNeeded"));
            } else {
                console.error("Cloud sync failed", error);

                if (showErrors) {
                    alert(t("cloudError"));
                }
            }
        } finally {
            cloudSyncInFlight = false;
            updateCloudSyncUI();
        }
    }

    async function initializeCloudSync() {
        updateCloudSyncUI();

        const code = safeStorageGet(TODAY_CLOUD_CODE_KEY);
        if (!code || !cloudSyncSupportedHere() || !crypto?.subtle) return;

        try {
            cloudSyncLastSeenFingerprint =
                await cloudFingerprint(buildCloudSnapshot());

            if (!safeStorageGet(TODAY_CLOUD_LAST_SYNCED_KEY)) {
                safeStorageSet(
                    TODAY_CLOUD_LOCAL_CHANGED_KEY,
                    String(Date.now())
                );
            }
        } catch (error) {
            return;
        }

        clearInterval(cloudSyncTimer);

        cloudSyncTimer = setInterval(() => {
            if (!document.hidden && navigator.onLine) {
                syncCloudNow(false);
            }
        }, 20000);

        window.addEventListener("online", () => syncCloudNow(false));

        document.addEventListener("visibilitychange", () => {
            if (!document.hidden && navigator.onLine) {
                syncCloudNow(false);
            }
        });

        setTimeout(() => syncCloudNow(false), 1200);
    }

    function exportTodayData() {
        const backup = {
            app: "Today",
            version: 1,
            exportedAt: new Date().toISOString(),
            data: {
                tasks,
                events,
                projects,
                dailyNotes,
                notes: document.getElementById("notes")?.value || "",
                activityHistory,
                dailyGoal,
                accentColor,
                appLanguage,
                darkMode: document.body.classList.contains("dark"),
                taskFilter: currentTaskFilter
            }
        };

        const blob = new Blob(
            [JSON.stringify(backup, null, 2)],
            { type: "application/json" }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `today-backup-${getDateKey()}.json`;

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function openImportPicker() {
        const input = document.getElementById("importDataInput");
        if (input) input.click();
    }

    async function importTodayData(file) {
        if (!file) return;

        try {
            const raw = await file.text();
            const parsed = JSON.parse(raw);
            const data = parsed?.data;

            if (!data || !Array.isArray(data.tasks) || !Array.isArray(data.events)) {
                alert("That file doesn't look like a Today backup.");
                return;
            }

            const okay = confirm(
                "Importing will replace the current Today data in this browser. Continue?"
            );

            if (!okay) return;

            const preImportSnapshot = {
                createdAt: new Date().toISOString(),
                tasks,
                events,
                projects,
                dailyNotes,
                notes: document.getElementById("notes")?.value || "",
                activityHistory,
                dailyGoal,
                accentColor,
                appLanguage,
                darkMode: document.body.classList.contains("dark"),
                taskFilter: currentTaskFilter
            };

            safeStorageSet(
                "todayPreImportBackup",
                JSON.stringify(preImportSnapshot)
            );

            safeStorageSet("tasks", JSON.stringify(data.tasks));
            safeStorageSet("events", JSON.stringify(data.events));
            safeStorageSet(
                "projects",
                JSON.stringify(Array.isArray(data.projects) ? data.projects : projects)
            );
            safeStorageSet(
                "dailyNotes",
                JSON.stringify(
                    data.dailyNotes && typeof data.dailyNotes === "object"
                        ? data.dailyNotes
                        : (data.notes ? { [getDateKey()]: String(data.notes) } : {})
                )
            );
            safeStorageSet("notes", String(data.notes || ""));
            safeStorageSet(
                "activityHistory",
                JSON.stringify(data.activityHistory && typeof data.activityHistory === "object"
                    ? data.activityHistory
                    : {})
            );
            safeStorageSet(
                "dailyGoal",
                String(Math.max(1, Number(data.dailyGoal) || 3))
            );
            safeStorageSet(
                "accentColor",
                String(data.accentColor || "graphite")
            );
            safeStorageSet(
                "appLanguage",
                ["en", "lt", "es"].includes(data.appLanguage) ? data.appLanguage : appLanguage
            );
            safeStorageSet(
                "darkMode",
                data.darkMode ? "true" : "false"
            );
            safeStorageSet(
                "taskFilter",
                String(data.taskFilter || "all")
            );

            location.reload();
        } catch (error) {
            alert("I couldn't read that backup file.");
        }
    }

    function updateNotificationStatus() {
        const status = document.getElementById("notificationStatus");
        if (!status) return;

        if (!("Notification" in window)) {
            status.textContent = t("browserNotificationsUnavailable");
            return;
        }

        if (Notification.permission === "granted") {
            status.textContent = t("browserNotificationsEnabled");
        } else if (Notification.permission === "denied") {
            status.textContent = t("browserNotificationsBlocked");
        } else {
            status.textContent = t("browserNotificationsOptional");
        }
    }

    async function enableBrowserNotifications() {
        if (!("Notification" in window)) {
            updateNotificationStatus();
            alert("This browser doesn't support notifications here. In-app reminders will still work.");
            return;
        }

        try {
            await Notification.requestPermission();
        } catch (error) {
            // Some local-file/browser combinations do not allow notification requests.
        }

        updateNotificationStatus();
    }

    function getReminderDateTime(task) {
        if (!task.dueDate || !task.reminderTime) return null;

        const date = new Date(`${task.dueDate}T${task.reminderTime}:00`);

        return Number.isNaN(date.getTime()) ? null : date;
    }

    function getReminderKey(task) {
        return `${task.id}|${task.dueDate}|${task.reminderTime}`;
    }

    function dismissReminderNotice() {
        const notice = document.getElementById("reminderNotice");
        if (notice) notice.classList.remove("show");

        if (currentReminderNoticeKey) {
            const dismissed = JSON.parse(safeStorageGet("dismissedReminders") || "{}");
            dismissed[currentReminderNoticeKey] = true;
            safeStorageSet("dismissedReminders", JSON.stringify(dismissed));
        }

        currentReminderNoticeKey = "";
    }

    function checkTaskReminders() {
        const now = new Date();
        const dismissed = JSON.parse(safeStorageGet("dismissedReminders") || "{}");

        const dueTask = tasks.find(task => {
            if (task.archived || task.completed) return false;

            const reminderDate = getReminderDateTime(task);
            if (!reminderDate) return false;

            const key = getReminderKey(task);
            if (dismissed[key]) return false;

            const ageMs = now.getTime() - reminderDate.getTime();

            return ageMs >= 0 && ageMs <= 12 * 60 * 60 * 1000;
        });

        const notice = document.getElementById("reminderNotice");

        if (!dueTask) {
            if (notice && !currentReminderNoticeKey) {
                notice.classList.remove("show");
            }
            return;
        }

        const key = getReminderKey(dueTask);

        if (currentReminderNoticeKey !== key) {
            currentReminderNoticeKey = key;

            const title = document.getElementById("reminderNoticeTitle");
            const detail = document.getElementById("reminderNoticeDetail");

            if (title) title.textContent = `${t("reminder")}: ${dueTask.text}`;
            if (detail) {
                detail.textContent =
                    `${formatDueDate(dueTask.dueDate)} at ${dueTask.reminderTime}`;
            }

            if (notice) notice.classList.add("show");

            const notified = JSON.parse(safeStorageGet("browserNotifiedReminders") || "{}");

            if (
                "Notification" in window &&
                Notification.permission === "granted" &&
                !notified[key]
            ) {
                try {
                    new Notification("Today reminder", {
                        body: dueTask.text
                    });

                    notified[key] = true;
                    safeStorageSet(
                        "browserNotifiedReminders",
                        JSON.stringify(notified)
                    );
                } catch (error) {
                    // In-app reminder remains available.
                }
            }
        }
    }

    function startReminderChecks() {
        clearInterval(reminderCheckTimer);
        checkTaskReminders();
        reminderCheckTimer = setInterval(checkTaskReminders, 30000);
    }

    function toggleEditCustomRepeat() {
        const repeat = document.getElementById("editTaskRepeat")?.value;
        const fields = document.getElementById("editCustomRepeatFields");

        if (fields) {
            fields.style.display = repeat === "custom" ? "grid" : "none";
        }
    }

    function openTaskEditor(index) {
        const task = tasks[index];
        if (!task) return;

        editingTaskIndex = index;

        document.getElementById("editTaskText").value = task.text || "";
        document.getElementById("editTaskPriority").value = task.priority || "medium";
        document.getElementById("editTaskDueDate").value = task.dueDate || "";
        syncProjectSelects();
        document.getElementById("editTaskProject").value = task.project || "";
        document.getElementById("editTaskRepeat").value = task.repeat || "none";
        document.getElementById("editTaskReminder").value = task.reminderTime || "";
        document.getElementById("editRepeatEvery").value = task.repeatEvery || 2;
        document.getElementById("editRepeatUnit").value = task.repeatUnit || "days";

        toggleEditCustomRepeat();

        document.getElementById("taskEditPanel").classList.add("open");
        document.getElementById("editTaskText").focus();
    }

    function closeTaskEditor() {
        editingTaskIndex = null;
        document.getElementById("taskEditPanel")?.classList.remove("open");
    }

    function saveTaskEdit() {
        if (editingTaskIndex === null || !tasks[editingTaskIndex]) return;

        const textValue = document.getElementById("editTaskText").value.trim();
        if (!textValue) return;

        const task = tasks[editingTaskIndex];

        task.text = textValue;
        task.priority = document.getElementById("editTaskPriority").value;
        task.dueDate = document.getElementById("editTaskDueDate").value;
        task.project = document.getElementById("editTaskProject").value || "";
        task.repeat = document.getElementById("editTaskRepeat").value;
        task.reminderTime = document.getElementById("editTaskReminder").value;
        task.repeatEvery = Math.max(
            1,
            Number(document.getElementById("editRepeatEvery").value) || 1
        );
        task.repeatUnit = document.getElementById("editRepeatUnit").value;

        saveTasks();
        closeTaskEditor();
        renderTasks();
        renderGlobalSearch();
        checkTaskReminders();
    }

    function archiveTask(index) {
        const task = tasks[index];
        if (!task) return;

        task.archived = true;
        saveTasks();
        renderTasks();
        renderGlobalSearch();
    }

    function restoreTask(index) {
        const task = tasks[index];
        if (!task) return;

        task.archived = false;
        saveTasks();
        renderTasks();
        renderGlobalSearch();
    }

    function archiveCompletedTasks() {
        let changed = false;

        tasks.forEach(task => {
            if (task.completed && !task.archived) {
                task.archived = true;
                changed = true;
            }
        });

        if (!changed) return;

        saveTasks();
        renderTasks();
        renderGlobalSearch();
    }

    function openEventEditor(index) {
        const event = events[index];
        if (!event) return;

        editingEventIndex = index;
        document.getElementById("editEventName").value = event.name || "";
        document.getElementById("editEventTime").value = event.time || "";
        document.getElementById("editEventDate").value = event.date || getDateKey();
        document.getElementById("editEventRepeat").value = event.repeat || "none";
        document.getElementById("editEventRepeatEvery").value = event.repeatEvery || 2;
        document.getElementById("editEventRepeatUnit").value = event.repeatUnit || "days";
        toggleEditEventCustomRepeat();
        document.getElementById("eventEditPanel").classList.add("open");
        document.getElementById("editEventName").focus();
    }

    function closeEventEditor() {
        editingEventIndex = null;
        document.getElementById("eventEditPanel")?.classList.remove("open");
    }

    function saveEventEdit() {
        if (editingEventIndex === null || !events[editingEventIndex]) return;

        const eventName = document.getElementById("editEventName").value.trim();
        const eventTime = document.getElementById("editEventTime").value;
        const eventDate = document.getElementById("editEventDate").value;

        if (!eventName || !eventTime || !eventDate) return;

        events[editingEventIndex].name = eventName;
        events[editingEventIndex].time = eventTime;
        events[editingEventIndex].date = eventDate;
        events[editingEventIndex].repeat =
            document.getElementById("editEventRepeat").value || "none";
        events[editingEventIndex].repeatEvery = Math.max(
            1,
            Number(document.getElementById("editEventRepeatEvery").value) || 1
        );
        events[editingEventIndex].repeatUnit =
            document.getElementById("editEventRepeatUnit").value || "days";

        sortEvents();

        selectedCalendarDate = eventDate;
        safeStorageSet("selectedCalendarDate", selectedCalendarDate);

        saveEvents();
        closeEventEditor();
        renderSchedule();
        renderCalendarWeek();
        renderDayAgenda();
        renderGlobalSearch();
    }

    function setTaskCompletion(index, completed) {
        const task = tasks[index];

        if (!task || task.archived || task.completed === completed) return;

        task.completed = completed;

        if (completed) {
            recordCompletion(task);
            createNextRecurringTask(task);
        } else {
            undoCompletion(task);
            undoRecurringGeneration(task);
        }

        saveTasks();
        renderTasks();
        renderGlobalSearch();
    }

    function toggleTaskCompletion(index) {
        const task = tasks[index];
        if (!task || task.archived) return;

        setTaskCompletion(index, !task.completed);
    }

    function getTodayFocusTasks() {
        const today = getDateKey();

        return tasks
            .map((task, index) => ({ task, index }))
            .filter(({ task }) =>
                !task.archived &&
                task.focusDate === today
            )
            .slice(0, 3);
    }

    function setFocusFeedback(message) {
        const feedback = document.getElementById("focusFeedback");
        if (!feedback) return;

        feedback.textContent = message || "";

        if (message) {
            clearTimeout(setFocusFeedback.timer);
            setFocusFeedback.timer = setTimeout(() => {
                if (feedback.textContent === message) {
                    feedback.textContent = "";
                }
            }, 2200);
        }
    }

    function toggleTaskFocus(index) {
        const task = tasks[index];
        if (!task || task.archived) return;

        const today = getDateKey();

        if (task.focusDate === today) {
            task.focusDate = "";
            saveTasks();
            renderTasks();
            setFocusFeedback(t("focusRemoved"));
            return;
        }

        if (getTodayFocusTasks().length >= 3) {
            setFocusFeedback(t("focusLimit"));
            return;
        }

        task.focusDate = today;
        saveTasks();
        renderTasks();
        setFocusFeedback(t("focusAdded"));
    }

    function renderFocusThree() {
        const list = document.getElementById("focusList");
        const count = document.getElementById("focusCount");

        if (!list || !count) return;

        const focused = getTodayFocusTasks();

        count.textContent = `${focused.length} / 3`;
        list.innerHTML = "";

        if (focused.length === 0) {
            const empty = document.createElement("div");
            empty.className = "focus-empty";
            empty.textContent = t("focusEmpty");
            list.appendChild(empty);
            return;
        }

        focused.forEach(({ task, index }) => {
            const item = document.createElement("div");
            item.className = "focus-item";

            if (task.completed) {
                item.classList.add("completed");
            }

            const complete = document.createElement("button");
            complete.type = "button";
            complete.className = "focus-complete-button";
            complete.textContent = task.completed ? "✓" : "○";
            complete.setAttribute(
                "aria-label",
                task.completed ? t("focusDone") : t("focusOpen")
            );
            complete.onclick = () => toggleTaskCompletion(index);

            const copy = document.createElement("div");
            copy.className = "focus-copy";

            const title = document.createElement("strong");
            title.textContent = task.text;

            const detail = document.createElement("span");
            const detailParts = [t(task.priority || "medium")];

            if (task.dueDate) {
                detailParts.push(formatDueDate(task.dueDate));
            }

            detail.textContent = detailParts.join(" · ");

            copy.appendChild(title);
            copy.appendChild(detail);

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "focus-remove-button";
            remove.textContent = "✕";
            remove.title = t("removeFromFocus");
            remove.setAttribute("aria-label", `${t("removeFromFocus")}: ${task.text}`);
            remove.onclick = () => toggleTaskFocus(index);

            item.appendChild(complete);
            item.appendChild(copy);
            item.appendChild(remove);

            list.appendChild(item);
        });
    }

    // Display tasks
    function renderTasks() {

        const list = document.getElementById("tasks");

        list.innerHTML = "";
        let visibleTaskCount = 0;

        tasks.forEach((task, index) => {

            const priority = task.priority || "medium";

            const archived = Boolean(task.archived);

            const shouldShow =
                (currentTaskFilter === "archived" && archived) ||
                (!archived && (
                    currentTaskFilter === "all" ||
                    (currentTaskFilter === "today" && isDueToday(task.dueDate)) ||
                    (currentTaskFilter === "upcoming" && isUpcoming(task.dueDate)) ||
                    (currentTaskFilter === "overdue" && isOverdueTask(task)) ||
                    (currentTaskFilter === "active" && !task.completed) ||
                    (currentTaskFilter === "completed" && task.completed) ||
                    (currentTaskFilter === "high" && priority === "high")
                ));

            const matchesProject =
                currentProjectFilter === "all" ||
                task.project === currentProjectFilter;

            if (!shouldShow || !matchesProject) return;

            const li = document.createElement("li");
            visibleTaskCount++;

            if (archived) {
                li.classList.add("archived-task");
            }

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = task.completed;

            checkbox.disabled = archived;

            checkbox.onchange = () => {
                setTaskCompletion(index, checkbox.checked);
            };

            const text = document.createElement("span");

            text.textContent = task.text;
            text.className = "task-text";

            if (task.completed) {
                text.classList.add("completed");
            }

            const priorityBadge = document.createElement("span");
            priorityBadge.className = `priority-badge priority-${priority}`;
            priorityBadge.textContent = t(priority);

            let projectBadge = null;

            if (task.project) {
                projectBadge = document.createElement("span");
                projectBadge.className = "project-badge";
                projectBadge.textContent = task.project;
            }

            let repeatBadge = null;

            if (task.repeat && task.repeat !== "none") {
                repeatBadge = document.createElement("span");
                repeatBadge.className = "repeat-badge";
                if (task.repeat === "daily") {
                    repeatBadge.textContent = `↻ ${t("daily")}`;
                } else if (task.repeat === "weekly") {
                    repeatBadge.textContent = `↻ ${t("weekly")}`;
                } else {
                    const amount = task.repeatEvery || 1;
                    const unit = task.repeatUnit === "weeks" ? t("weekShort") : t("dayShort");
                    repeatBadge.textContent = `↻ ${t("every")} ${amount} ${unit}`;
                }
            }

            let dueDateBadge = null;

            if (task.dueDate) {
                dueDateBadge = document.createElement("span");

                const dueStatus = getDueDateStatus(task.dueDate);

                dueDateBadge.className = "due-date";

                if (dueStatus) {
                    dueDateBadge.classList.add(dueStatus);
                }

                dueDateBadge.textContent =
                    dueStatus === "today"
                        ? t("dueToday")
                        : dueStatus === "overdue"
                            ? `${t("overdue")} · ${formatDueDate(task.dueDate)}`
                            : `${t("due")} ${formatDueDate(task.dueDate)}`;
            }

            let reminderBadge = null;

            if (task.reminderTime && task.dueDate) {
                reminderBadge = document.createElement("span");
                reminderBadge.className = "reminder-badge";
                reminderBadge.textContent = `⏰ ${task.reminderTime}`;
            }

            let archivedBadge = null;

            if (archived) {
                archivedBadge = document.createElement("span");
                archivedBadge.className = "archived-badge";
                archivedBadge.textContent = t("archived");
            }

            text.onclick = () => {
                toggleTaskCompletion(index);
            };

            const actions = document.createElement("div");
            actions.className = "task-actions";

            const focusButton = document.createElement("button");
            focusButton.textContent = task.focusDate === getDateKey() ? "⭐" : "☆";
            focusButton.className = "icon-action task-focus-button";
            focusButton.classList.toggle("is-focused", task.focusDate === getDateKey());
            focusButton.title =
                task.focusDate === getDateKey()
                    ? t("removeFromFocus")
                    : t("addToFocus");
            focusButton.setAttribute(
                "aria-label",
                `${focusButton.title}: ${task.text}`
            );
            focusButton.onclick = () => toggleTaskFocus(index);

            const editButton = document.createElement("button");
            editButton.textContent = "✏️";
            editButton.className = "icon-action";
            editButton.title = "Edit task";
            editButton.setAttribute("aria-label", `Edit ${task.text}`);
            editButton.onclick = () => openTaskEditor(index);

            const archiveButton = document.createElement("button");
            archiveButton.className = "icon-action";
            archiveButton.textContent = archived ? "↩️" : "📦";
            archiveButton.title = archived ? "Restore task" : "Archive task";
            archiveButton.setAttribute(
                "aria-label",
                archived ? `Restore ${task.text}` : `Archive ${task.text}`
            );
            archiveButton.onclick = () => {
                if (archived) {
                    restoreTask(index);
                } else {
                    archiveTask(index);
                }
            };

            const deleteButton = document.createElement("button");
            deleteButton.textContent = "🗑️";
            deleteButton.className = "icon-action";
            deleteButton.title = "Delete task";
            deleteButton.setAttribute("aria-label", `Delete ${task.text}`);

            deleteButton.onclick = () => {
                tasks.splice(index, 1);
                saveTasks();
                renderTasks();
                renderGlobalSearch();
            };

            if (!archived) {
                actions.appendChild(focusButton);
            }

            actions.appendChild(editButton);

            if (task.completed || archived) {
                actions.appendChild(archiveButton);
            }

            actions.appendChild(deleteButton);

            li.appendChild(checkbox);
            li.appendChild(text);

            if (dueDateBadge) {
                li.appendChild(dueDateBadge);
            }

            if (reminderBadge) {
                li.appendChild(reminderBadge);
            }

            if (repeatBadge) {
                li.appendChild(repeatBadge);
            }

            if (archivedBadge) {
                li.appendChild(archivedBadge);
            }

            if (projectBadge) {
                li.appendChild(projectBadge);
            }

            li.appendChild(priorityBadge);
            li.appendChild(actions);

            list.appendChild(li);
        });

        if (visibleTaskCount === 0) {
            const empty = document.createElement("li");
            empty.className = "empty-list-state";
            empty.textContent = t("emptyTasks");
            list.appendChild(empty);
        }

        updateProgress();
        updateStats();
        updateOverdueNotice();
        renderTomorrowPlanner();
        renderCalendarWeek();
        renderDayAgenda();
        renderReminderCenter();
        updateEveningReset();
        renderFocusThree();
    }
function sortEvents() {
    events.sort((a, b) =>
        (a.date || "").localeCompare(b.date || "") ||
        (a.time || "").localeCompare(b.time || "")
    );
}

function eventOccursOnDate(event, dateKey) {
    if (!event?.date || !dateKey) return false;

    const start = parseDateKey(event.date);
    const target = parseDateKey(dateKey);

    if (target < start) return false;
    if (!event.repeat || event.repeat === "none") return event.date === dateKey;

    const diffDays = Math.round(
        (target.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)
    );

    if (event.repeat === "daily") return true;
    if (event.repeat === "weekly") return diffDays % 7 === 0;

    const every = Math.max(1, Number(event.repeatEvery) || 1);    const intervalDays = event.repeatUnit === "weeks" ? every * 7 : every;

    return diffDays % intervalDays === 0;
}

function getEventsForDate(dateKey) {
    return events
        .map((event, index) => ({ event, index }))
        .filter(({ event }) => eventOccursOnDate(event, dateKey))
        .sort((a, b) => (a.event.time || "").localeCompare(b.event.time || ""));
}

function getEventRepeatLabel(event) {
    if (!event?.repeat || event.repeat === "none") return "";
    if (event.repeat === "daily") return t("daily");
    if (event.repeat === "weekly") return t("weekly");

    const every = Math.max(1, Number(event.repeatEvery) || 1);
    const unit = event.repeatUnit === "weeks" ? t("weeks") : t("days");
    return `${t("every")} ${every} ${unit}`;
}

function toggleEventCustomRepeat() {
    const repeat = document.getElementById("eventRepeatInput")?.value;
    const fields = document.getElementById("eventCustomRepeatControls");
    if (fields) fields.style.display = repeat === "custom" ? "grid" : "none";
}

function toggleEditEventCustomRepeat() {
    const repeat = document.getElementById("editEventRepeat")?.value;
    const fields = document.getElementById("editEventCustomRepeatFields");
    if (fields) fields.style.display = repeat === "custom" ? "grid" : "none";
}

function syncEventRepeatTranslations() {
    [
        ["eventRepeatInput", "none", "noRepeat"],
        ["eventRepeatInput", "daily", "daily"],
        ["eventRepeatInput", "weekly", "weekly"],
        ["eventRepeatInput", "custom", "custom"],
        ["editEventRepeat", "none", "noRepeat"],
        ["editEventRepeat", "daily", "daily"],
        ["editEventRepeat", "weekly", "weekly"],
        ["editEventRepeat", "custom", "custom"],
        ["eventRepeatUnitInput", "days", "days"],
        ["eventRepeatUnitInput", "weeks", "weeks"],
        ["editEventRepeatUnit", "days", "days"],
        ["editEventRepeatUnit", "weeks", "weeks"]
    ].forEach(([id, value, key]) => {
        const option = document.querySelector(`#${id} option[value="${value}"]`);
        if (option) option.textContent = t(key);
    });
}

// Calendar

function setCalendarView(view) {
    calendarView = view === "month" ? "month" : "week";
    safeStorageSet("calendarView", calendarView);

    const week = document.getElementById("calendarWeek");
    const month = document.getElementById("calendarMonth");
    const agenda = document.querySelector(".day-agenda");
    const weekButton = document.getElementById("weekViewButton");
    const monthButton = document.getElementById("monthViewButton");

    if (week) week.classList.toggle("hidden-view", calendarView === "month");
    if (month) month.classList.toggle("show", calendarView === "month");
    if (agenda) agenda.classList.remove("hidden-view");

    if (weekButton) weekButton.classList.toggle("active", calendarView === "week");
    if (monthButton) monthButton.classList.toggle("active", calendarView === "month");

    updateCalendarNavigationLabels();
    updateCalendarPeriodLabel();
    renderCalendarMonth();
}

function updateCalendarNavigationLabels() {
    const previous = document.querySelector('[onclick="changeCalendarPeriod(-1)"]');
    const next = document.querySelector('[onclick="changeCalendarPeriod(1)"]');

    if (previous) {
        previous.setAttribute(
            "aria-label",
            calendarView === "month" ? t("previousMonth") : t("previousWeek")
        );
    }

    if (next) {
        next.setAttribute(
            "aria-label",
            calendarView === "month" ? t("nextMonth") : t("nextWeek")
        );
    }
}

function updateCalendarPeriodLabel() {
    const label = document.getElementById("calendarWeekLabel");
    if (!label) return;

    if (calendarView === "month") {
        const selected = parseDateKey(selectedCalendarDate);
        label.textContent = selected.toLocaleDateString(getAppLocale(), {
            month: "long",
            year: "numeric"
        });
        return;
    }

    const start = getWeekStartForDate(selectedCalendarDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);

    label.textContent =
        `${start.toLocaleDateString(getAppLocale(), { month: "short", day: "numeric" })} – ` +
        `${end.toLocaleDateString(getAppLocale(), { month: "short", day: "numeric" })}`;
}

function renderCalendarMonth() {
    const month = document.getElementById("calendarMonth");
    if (!month) return;

    month.innerHTML = "";

    const selected = parseDateKey(selectedCalendarDate);
    const year = selected.getFullYear();
    const monthIndex = selected.getMonth();

    const weekdayFormatter = new Intl.DateTimeFormat(getAppLocale(), {
        weekday: "short"
    });

    for (let i = 0; i < 7; i++) {
        const sampleMonday = new Date(2024, 0, 1 + i);

        const label = document.createElement("div");
        label.className = "month-weekday";
        label.textContent = weekdayFormatter.format(sampleMonday);
        month.appendChild(label);
    }

    const first = new Date(year, monthIndex, 1);
    first.setHours(0, 0, 0, 0);

    const firstDay = first.getDay();
    const offset = firstDay === 0 ? -6 : 1 - firstDay;

    const cursor = new Date(first);
    cursor.setDate(cursor.getDate() + offset);

    const todayKey = getDateKey();

    for (let i = 0; i < 42; i++) {
        const date = new Date(cursor);
        date.setDate(cursor.getDate() + i);

        const key = getDateKey(date);

        const taskCount = tasks.filter(task =>
            !task.archived &&
            !task.completed &&
            task.dueDate === key
        ).length;

        const eventCount = getEventsForDate(key).length;
        const total = taskCount + eventCount;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "month-day";

        if (date.getMonth() !== monthIndex) button.classList.add("outside");
        if (key === todayKey) button.classList.add("today");
        if (key === selectedCalendarDate) button.classList.add("selected");

        const number = document.createElement("span");
        number.className = "month-day-number";
        number.textContent = date.getDate();

        const count = document.createElement("span");
        count.className = "month-day-count";

        if (total > 0) {
            count.classList.add("has-items");
            count.textContent = `${total}`;
        } else {
            count.textContent = "";
        }

        const details = [];

        if (taskCount > 0) {
            details.push(
                tr("calendarTaskCount", {
                    count: taskCount,
                    suffix: taskCount === 1 ? "" : "s"
                })
            );
        }

        if (eventCount > 0) {
            details.push(
                tr("calendarEventCount", {
                    count: eventCount,
                    suffix: eventCount === 1 ? "" : "s"
                })
            );
        }

        button.setAttribute(
            "aria-label",
            details.length
                ? `${formatLongCalendarDate(key)} · ${details.join(", ")}`
                : formatLongCalendarDate(key)
        );

        button.appendChild(number);
        button.appendChild(count);

        button.onclick = () => selectCalendarDate(key);

        month.appendChild(button);
    }
}

function parseDateKey(dateKey) {
    const parts = String(dateKey || "").split("-").map(Number);

    if (parts.length !== 3 || parts.some(Number.isNaN)) {
        const fallback = new Date();
        fallback.setHours(0, 0, 0, 0);
        return fallback;
    }

    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    date.setHours(0, 0, 0, 0);
    return date;
}

function getWeekStartForDate(dateKey) {
    const date = parseDateKey(dateKey);
    const day = date.getDay();
    const diff = day === 0 ? -6 : 1 - day;

    date.setDate(date.getDate() + diff);
    return date;
}

function formatLongCalendarDate(dateKey) {
    return parseDateKey(dateKey).toLocaleDateString(getAppLocale(), {
        weekday: "long",
        month: "long",
        day: "numeric"
    });
}

function saveDailyNotes() {
    safeStorageSet("dailyNotes", JSON.stringify(dailyNotes));
}

function loadDailyNote() {
    const notes = document.getElementById("notes");
    const label = document.getElementById("notesDateLabel");
    const status = document.getElementById("notesSaveStatus");

    if (notes) notes.value = dailyNotes[selectedCalendarDate] || "";
    if (label) label.textContent = formatLongCalendarDate(selectedCalendarDate);
    if (status) status.textContent = "";
}

function selectCalendarDate(dateKey) {
    selectedCalendarDate = dateKey;
    safeStorageSet("selectedCalendarDate", selectedCalendarDate);

    const dateInput = document.getElementById("eventDateInput");
    if (dateInput) dateInput.value = selectedCalendarDate;

    renderCalendarWeek();
    renderDayAgenda();
    renderSchedule();
    loadDailyNote();
}

function goCalendarToday() {
    selectCalendarDate(getDateKey());
}

function prepareTaskForSelectedDate() {
    const dueDate = document.getElementById("dueDateInput");
    const input = document.getElementById("taskInput");

    if (dueDate) dueDate.value = selectedCalendarDate;

    if (input) {
        input.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => input.focus(), 220);
    }
}

function prepareEventForSelectedDate() {
    const dateInput = document.getElementById("eventDateInput");
    const eventInput = document.getElementById("eventInput");

    if (dateInput) dateInput.value = selectedCalendarDate;

    if (eventInput) {
        eventInput.scrollIntoView({ behavior: "smooth", block: "center" });
        setTimeout(() => eventInput.focus(), 220);
    }
}

function changeCalendarPeriod(direction) {
    const step = Number(direction) || 0;
    if (!step) return;

    const date = parseDateKey(selectedCalendarDate);

    if (calendarView === "month") {
        const desiredDay = date.getDate();

        date.setDate(1);
        date.setMonth(date.getMonth() + step);

        const lastDay = new Date(
            date.getFullYear(),
            date.getMonth() + 1,
            0
        ).getDate();

        date.setDate(Math.min(desiredDay, lastDay));
    } else {
        date.setDate(date.getDate() + step * 7);
    }

    selectCalendarDate(getDateKey(date));
}

function renderCalendarWeek() {
    const week = document.getElementById("calendarWeek");
    const label = document.getElementById("calendarWeekLabel");

    if (!week || !label) return;

    const start = getWeekStartForDate(selectedCalendarDate);
    updateCalendarPeriodLabel();

    week.innerHTML = "";

    const todayKey = getDateKey();

    for (let i = 0; i < 7; i++) {
        const date = new Date(start);
        date.setDate(date.getDate() + i);

        const dateKey = getDateKey(date);

        const taskCount = tasks.filter(task =>
            !task.archived &&
            !task.completed &&
            task.dueDate === dateKey
        ).length;

        const eventCount = getEventsForDate(dateKey).length;
        const totalCount = taskCount + eventCount;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "calendar-day";
        button.setAttribute("aria-label", formatLongCalendarDate(dateKey));

        if (dateKey === selectedCalendarDate) {
            button.classList.add("selected");
        }

        if (dateKey === todayKey) {
            button.classList.add("today");
        }

        const dayName = document.createElement("span");
        dayName.className = "calendar-day-name";
        dayName.textContent = date.toLocaleDateString(getAppLocale(), { weekday: "short" });

        const dayNumber = document.createElement("span");
        dayNumber.className = "calendar-day-number";
        dayNumber.textContent = date.getDate();

        const count = document.createElement("span");
        count.className = "calendar-day-count";
        count.textContent = totalCount > 0 ? `${totalCount} ${totalCount === 1 ? t("item") : t("items")}` : "";

        button.appendChild(dayName);
        button.appendChild(dayNumber);
        button.appendChild(count);

        button.onclick = () => selectCalendarDate(dateKey);

        week.appendChild(button);
    }

    renderCalendarMonth();
    setCalendarView(calendarView);
}

function renderDayAgenda() {
    const list = document.getElementById("dayAgendaList");
    const title = document.getElementById("dayAgendaTitle");
    const count = document.getElementById("dayAgendaCount");

    if (!list || !title || !count) return;

    const date = parseDateKey(selectedCalendarDate);

    title.textContent = date.toLocaleDateString(getAppLocale(), {
        weekday: "long",
        month: "short",
        day: "numeric"
    });

    const dayTasks = tasks
        .map((task, index) => ({ task, index }))
        .filter(({ task }) => !task.archived && task.dueDate === selectedCalendarDate);

    const dayEvents = getEventsForDate(selectedCalendarDate);

    const total = dayTasks.length + dayEvents.length;
    count.textContent = `${total} ${total === 1 ? t("item") : t("items")}`;

    list.innerHTML = "";

    if (total === 0) {
        const empty = document.createElement("div");
        empty.className = "agenda-empty";
        empty.textContent = t("nothingPlanned");
        list.appendChild(empty);
        return;
    }

    dayEvents.forEach(({ event, index }) => {
        const item = document.createElement("div");
        item.className = "agenda-item";

        const icon = document.createElement("div");
        icon.className = "agenda-icon";
        icon.textContent = "🕒";

        const copy = document.createElement("div");
        copy.className = "agenda-copy";

        const name = document.createElement("strong");
        name.textContent = event.name;

        const detail = document.createElement("span");
        detail.textContent = [
            t("scheduleType"),
            event.time,
            getEventRepeatLabel(event) ? `↻ ${getEventRepeatLabel(event)}` : ""
        ].filter(Boolean).join(" · ");

        copy.appendChild(name);
        copy.appendChild(detail);

        const action = document.createElement("button");
        action.type = "button";
        action.className = "icon-action";
        action.textContent = "✏️";
        action.title = "Edit event";
        action.onclick = () => openEventEditor(index);

        item.appendChild(icon);
        item.appendChild(copy);
        item.appendChild(action);
        list.appendChild(item);
    });

    dayTasks.forEach(({ task, index }) => {
        const item = document.createElement("div");
        item.className = "agenda-item";

        const icon = document.createElement("div");
        icon.className = "agenda-icon";
        icon.textContent = task.completed ? "✅" : "☑️";

        const copy = document.createElement("div");
        copy.className = "agenda-copy";

        const name = document.createElement("strong");
        name.textContent = task.text;

        const detail = document.createElement("span");
        const priority = task.priority || "medium";
        detail.textContent = [
            t("taskTypeLabel"),
            task.project || "",
            `${t(priority)} ${t("priorityWord")}`
        ].filter(Boolean).join(" · ");

        copy.appendChild(name);
        copy.appendChild(detail);

        const status = document.createElement("span");
        status.className = "agenda-status";
        status.textContent = task.completed ? t("doneStatus") : t("openStatus");

        item.appendChild(icon);
        item.appendChild(copy);
        item.appendChild(status);
        list.appendChild(item);
    });
}

// Schedule

function addEvent() {
    const time = document.getElementById("timeInput").value;
    const eventDate = document.getElementById("eventDateInput").value || selectedCalendarDate;
    const eventName = document.getElementById("eventInput").value.trim();
    const repeat = document.getElementById("eventRepeatInput")?.value || "none";
    const repeatEvery = Math.max(
        1,
        Number(document.getElementById("eventRepeatEveryInput")?.value) || 1
    );
    const repeatUnit = document.getElementById("eventRepeatUnitInput")?.value || "days";

    if (!time || !eventName || !eventDate) return;

    events.push({
        id: createLocalId("event"),
        time,
        date: eventDate,
        name: eventName,
        repeat,
        repeatEvery,
        repeatUnit
    });

    sortEvents();
    saveEvents();

    selectedCalendarDate = eventDate;
    safeStorageSet("selectedCalendarDate", selectedCalendarDate);

    renderSchedule();
    renderCalendarWeek();
    renderDayAgenda();

    document.getElementById("timeInput").value = "";
    document.getElementById("eventDateInput").value = selectedCalendarDate;
    document.getElementById("eventInput").value = "";
    document.getElementById("eventRepeatInput").value = "none";
    document.getElementById("eventRepeatEveryInput").value = "2";
    document.getElementById("eventRepeatUnitInput").value = "days";
    toggleEventCustomRepeat();
    renderGlobalSearch();
}

function saveEvents() {
    safeStorageSet("events", JSON.stringify(events));
}

function renderSchedule() {

    const schedule = document.getElementById("schedule");
    const title = document.getElementById("scheduleTitle");
    const dateLabel = document.getElementById("scheduleDateLabel");
    const dateInput = document.getElementById("eventDateInput");

    if (!schedule) return;

    schedule.innerHTML = "";

    if (title) {
        title.textContent =
            selectedCalendarDate === getDateKey()
                ? t("todaySchedule")
                : t("schedule");
    }

    if (dateLabel) {
        dateLabel.textContent = formatLongCalendarDate(selectedCalendarDate);
    }

    if (dateInput) {
        dateInput.value = selectedCalendarDate;
    }

    const scheduleEvents = getEventsForDate(selectedCalendarDate);

    scheduleEvents.forEach(({ event, index }) => {
        const item = document.createElement("li");
        item.className = "schedule-item";

        const time = document.createElement("span");
        time.className = "schedule-time";
        time.textContent = event.time;

        const name = document.createElement("span");
        name.className = "schedule-event";
        name.textContent = event.name;

        const repeatLabel = getEventRepeatLabel(event);
        if (repeatLabel) {
            const badge = document.createElement("span");
            badge.className = "event-repeat-badge";
            badge.textContent = `↻ ${repeatLabel}`;
            name.appendChild(badge);
        }

        const actions = document.createElement("div");
        actions.className = "schedule-actions";

        const editButton = document.createElement("button");
        editButton.className = "icon-action";
        editButton.textContent = "✏️";
        editButton.title = "Edit event";
        editButton.setAttribute("aria-label", `Edit ${event.name}`);
        editButton.onclick = () => openEventEditor(index);

        const deleteButton = document.createElement("button");
        deleteButton.className = "icon-action";
        deleteButton.textContent = "🗑️";
        deleteButton.title = "Delete event";
        deleteButton.setAttribute("aria-label", `Delete ${event.name}`);

        deleteButton.onclick = () => {
            events.splice(index, 1);
            saveEvents();
            renderSchedule();
            renderGlobalSearch();
        };

        actions.appendChild(editButton);
        actions.appendChild(deleteButton);

        item.appendChild(time);
        item.appendChild(name);
        item.appendChild(actions);

        schedule.appendChild(item);
    });

    if (scheduleEvents.length === 0) {
        const empty = document.createElement("li");
        empty.className = "empty-list-state";
        empty.textContent = t("emptySchedule");
        schedule.appendChild(empty);
    }

    renderCalendarWeek();
    renderDayAgenda();
}

renderSchedule();
    function renderReminderCenter() {
        const list = document.getElementById("reminderCenterList");
        const dueTodayCount = document.getElementById("reminderDueTodayCount");
        const upcomingCount = document.getElementById("reminderUpcomingCount");
        const overdueCount = document.getElementById("reminderOverdueCount");

        if (!list || !dueTodayCount || !upcomingCount || !overdueCount) return;

        const today = getDateKey();
        const now = new Date();

        const dueTodayTasks = tasks.filter(task =>
            !task.archived &&
            !task.completed &&
            task.dueDate === today
        );

        const overdueTasks = tasks.filter(task =>
            !task.archived &&
            !task.completed &&
            isOverdueTask(task)
        );

        const reminderTasks = tasks
            .filter(task => {
                if (task.archived || task.completed || !task.dueDate || !task.reminderTime) {
                    return false;
                }

                const reminderDate = getReminderDateTime(task);
                return reminderDate && reminderDate >= now;
            })
            .sort((a, b) => {
                const aDate = getReminderDateTime(a)?.getTime() || Infinity;
                const bDate = getReminderDateTime(b)?.getTime() || Infinity;
                return aDate - bDate;
            });

        dueTodayCount.textContent = dueTodayTasks.length;
        upcomingCount.textContent = reminderTasks.length;
        overdueCount.textContent = overdueTasks.length;

        const attention = [
            ...overdueTasks.slice(0, 2).map(task => ({ task, type: "overdue" })),
            ...dueTodayTasks
                .filter(task => !overdueTasks.includes(task))
                .slice(0, 2)
                .map(task => ({ task, type: "today" })),
            ...reminderTasks
                .filter(task => !overdueTasks.includes(task) && !dueTodayTasks.includes(task))
                .slice(0, 3)
                .map(task => ({ task, type: "reminder" }))
        ].slice(0, 5);

        list.innerHTML = "";

        if (attention.length === 0) {
            const empty = document.createElement("div");
            empty.className = "reminder-center-empty";
            empty.textContent = t("noReminderItems");
            list.appendChild(empty);
            return;
        }

        attention.forEach(({ task, type }) => {
            const index = tasks.indexOf(task);

            const item = document.createElement("div");
            item.className = "reminder-center-item";

            const icon = document.createElement("div");
            icon.className = "reminder-center-icon";
            icon.textContent =
                type === "overdue" ? "⚠️" :
                type === "today" ? "📌" : "⏰";

            const copy = document.createElement("div");
            copy.className = "reminder-center-copy";

            const title = document.createElement("strong");
            title.textContent = task.text;

            const detail = document.createElement("span");

            if (type === "overdue") {
                detail.textContent = `${t("overdue")} · ${formatDueDate(task.dueDate)}`;
            } else if (type === "today") {
                detail.textContent = task.reminderTime
                    ? tr("reminderAt", { time: task.reminderTime })
                    : t("dueTodayCenter");
            } else {
                detail.textContent =
                    `${formatDueDate(task.dueDate)} · ${tr("reminderAt", { time: task.reminderTime })}`;
            }

            copy.appendChild(title);
            copy.appendChild(detail);

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "icon-action";
            edit.textContent = "✏️";
            edit.title = t("editTask");
            edit.onclick = () => openTaskEditor(index);

            item.appendChild(icon);
            item.appendChild(copy);
            item.appendChild(edit);

            list.appendChild(item);
        });
    }

    function updateEveningReset() {
        const progress = document.getElementById("eveningResetProgress");
        if (!progress) return;

        const today = getDateKey();

        const unfinished = tasks.filter(task =>
            !task.archived &&
            !task.completed &&
            task.dueDate === today
        );

        if (unfinished.length === 0) {
            progress.textContent = t("allWrapped");
        } else {
            progress.textContent = tr("unfinishedToday", {
                count: unfinished.length,
                suffix: unfinished.length === 1 ? "" : "s"
            });
        }
    }

    function moveUnfinishedTodayToTomorrow() {
        const today = getDateKey();
        const tomorrow = getTomorrowKey();

        const unfinished = tasks.filter(task =>
            !task.archived &&
            !task.completed &&
            task.dueDate === today
        );

        if (unfinished.length === 0) {
            const progress = document.getElementById("eveningResetProgress");
            if (progress) progress.textContent = t("nothingToMove");
            return;
        }

        unfinished.forEach(task => {
            task.dueDate = tomorrow;
        });

        saveTasks();
        renderTasks();
        renderTomorrowPlanner();
        renderCalendarWeek();
        renderDayAgenda();
        renderReminderCenter();

        const progress = document.getElementById("eveningResetProgress");
        if (progress) {
            progress.textContent = tr("movedTomorrow", {
                count: unfinished.length,
                suffix: unfinished.length === 1 ? "" : "s"
            });
        }
    }

    function focusTomorrowPlanner() {
        const input = document.getElementById("tomorrowTaskInput");

        if (input) {
            input.scrollIntoView({ behavior: "smooth", block: "center" });
            setTimeout(() => input.focus(), 250);
        }
    }

    function reviewTodayTasks() {
        currentTaskFilter = "today";
        safeStorageSet("taskFilter", currentTaskFilter);

        syncTaskFilterButtons();
        renderTasks();

        const list = document.getElementById("tasks");
        if (list) {
            list.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }

    function updateOverdueNotice() {
        const overdueCount = tasks.filter(task => !task.archived && isOverdueTask(task)).length;
        const notice = document.getElementById("overdueNotice");
        const title = document.getElementById("overdueTitle");

        if (!notice || !title) return;

        notice.classList.toggle("hidden", overdueCount === 0);

        if (overdueCount > 0) {
            title.textContent =
                `${overdueCount} ${t("overdue")}`;
        }
    }

    function showOverdueTasks() {
        currentTaskFilter = "overdue";
        safeStorageSet("taskFilter", currentTaskFilter);
        syncTaskFilterButtons();
        renderTasks();
    }

    function moveOverdueToToday() {
        const today = getDateKey();
        let changed = false;

        tasks.forEach(task => {
            if (!task.archived && isOverdueTask(task)) {
                task.dueDate = today;
                changed = true;
            }
        });

        if (!changed) return;

        currentTaskFilter = "today";
        safeStorageSet("taskFilter", currentTaskFilter);

        saveTasks();
        syncTaskFilterButtons();
        renderTasks();
    }

    function addTomorrowTask() {
        const input = document.getElementById("tomorrowTaskInput");
        const priorityInput = document.getElementById("tomorrowPriorityInput");
        const taskText = input.value.trim();

        if (!taskText) return;

        tasks.push({
            id: createLocalId("task"),
            text: taskText,
            completed: false,
            priority: priorityInput.value,
            dueDate: getTomorrowKey(),
            repeat: "none",
            repeatEvery: 1,
            repeatUnit: "days",
            reminderTime: "",
            archived: false,
            recurrenceGenerated: false,
            focusDate: ""
        });

        input.value = "";
        priorityInput.value = "medium";

        saveTasks();
        renderTasks();
    }

    function handleTomorrowEnter(event) {
        if (event.key === "Enter") {
            addTomorrowTask();
        }
    }

    function removeTomorrowTask(taskIndex) {
        tasks.splice(taskIndex, 1);
        saveTasks();
        renderTasks();
    }

    function renderTomorrowPlanner() {
        const list = document.getElementById("tomorrowList");
        const dateLabel = document.getElementById("tomorrowDate");

        if (!list || !dateLabel) return;

        const tomorrowKey = getTomorrowKey();
        const tomorrowDate = new Date(tomorrowKey + "T00:00:00");

        dateLabel.textContent = tomorrowDate.toLocaleDateString(getAppLocale(), {
            weekday: "short",
            month: "short",
            day: "numeric"
        });

        list.innerHTML = "";

        tasks.forEach((task, index) => {
            if (task.archived || task.completed || task.dueDate !== tomorrowKey) return;

            const item = document.createElement("li");
            item.className = "tomorrow-item";

            const name = document.createElement("span");
            name.className = "task-text";
            name.textContent = task.text;

            const priority = task.priority || "medium";
            const badge = document.createElement("span");
            badge.className = `priority-badge priority-${priority}`;
            badge.textContent = t(priority);

            const deleteButton = document.createElement("button");
            deleteButton.className = "delete";
            deleteButton.textContent = "🗑️";
            deleteButton.setAttribute("aria-label", `Delete ${task.text}`);
            deleteButton.onclick = () => removeTomorrowTask(index);

            item.appendChild(name);
            item.appendChild(badge);
            item.appendChild(deleteButton);
            list.appendChild(item);
        });
    }

    function setTaskFilter(filter, button) {
        currentTaskFilter = filter;
        safeStorageSet("taskFilter", filter);

        document.querySelectorAll(".filter-button").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.filter === filter);
        });

        renderTasks();
    }

    function syncTaskFilterButtons() {
        document.querySelectorAll(".filter-button").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.filter === currentTaskFilter);
        });
    }

    // Add task
    function addTask() {

        const input = document.getElementById("taskInput");

        const text = input.value.trim();
        const priority = document.getElementById("priorityInput").value;
        const dueDate = document.getElementById("dueDateInput").value;        const project = document.getElementById("projectInput").value || "";
        const repeat = document.getElementById("repeatInput").value;
        const reminderTime = document.getElementById("reminderInput").value;
        const repeatEvery = Math.max(
            1,
            Number(document.getElementById("repeatEveryInput").value) || 1
        );
        const repeatUnit = document.getElementById("repeatUnitInput").value;

        if (text === "") return;

        tasks.push({
            id: createLocalId("task"),
            text: text,
            completed: false,
            priority: priority,
            dueDate: dueDate,
            project: project,
            repeat: repeat,
            repeatEvery: repeatEvery,
            repeatUnit: repeatUnit,
            reminderTime: reminderTime,
            archived: false,
            recurrenceGenerated: false,
            focusDate: ""
        });

        input.value = "";
        document.getElementById("priorityInput").value = "medium";
        document.getElementById("dueDateInput").value = "";
        document.getElementById("projectInput").value = "";
        document.getElementById("repeatInput").value = "none";
        document.getElementById("reminderInput").value = "";
        document.getElementById("repeatEveryInput").value = "2";
        document.getElementById("repeatUnitInput").value = "days";
        toggleCustomRepeat();

        saveTasks();
        renderTasks();
    }

    // Enter key
    function handleEnter(event) {

        if (event.key === "Enter") {
            addTask();
        }
    }

    // Save tasks
    function saveTasks() {
        safeStorageSet("tasks", JSON.stringify(tasks));
    }

    // Progress
    function updateProgress() {

        const activeTasks = tasks.filter(task => !task.archived);
        const total = activeTasks.length;

        const completed = activeTasks.filter(task => task.completed).length;

        document.getElementById("progressText").textContent =
            `${completed} / ${total}`;

        const percentage =
            total === 0 ? 0 : (completed / total) * 100;

        document.getElementById("progressBar").style.width =
            percentage + "%";
    }

  function setAccentColor(color) {
    const allowed = ["graphite", "blue", "green", "purple", "rose"];
    accentColor = allowed.includes(color) ? color : "graphite";

    document.body.dataset.accent = accentColor;
    safeStorageSet("accentColor", accentColor);

    const select = document.getElementById("accentSelect");
    if (select) select.value = accentColor;
}

function loadAccentColor() {
    setAccentColor(accentColor);
}

// Dark mode
function toggleTheme() {
    document.body.classList.toggle("dark");

    const dark = document.body.classList.contains("dark");

    safeStorageSet("darkMode", dark);

    document.getElementById("themeButton").textContent =
        dark ? "☀️" : "🌙";

    updateSettingsThemeButton();
}

// Load dark mode
if (safeStorageGet("darkMode") === "true") {
    document.body.classList.add("dark");

    document.getElementById("themeButton").textContent = "☀️";
}
async function getWeather() {

    const latitude = 55.7033;
    const longitude = 21.1443;

    try {

        const response = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,weather_code&timezone=auto`
        );

        const data = await response.json();

        const temperature = Math.round(
            data.current.temperature_2m
        );

        const code = data.current.weather_code;

       const hour = new Date().getHours();

let description = t("weatherClear");
let icon = hour >= 19 || hour < 6 ? "🌙" : "☀️";

        if (code >= 1 && code <= 3) {
    description = t("weatherPartly");
    icon = (hour >= 19 || hour < 6) ? "☁️🌙" : "🌤️";
        } else if (code >= 45 && code <= 48) {
            description = t("weatherFog");
            icon = "🌫️";
        } else if (code >= 51 && code <= 67) {
            description = t("weatherRain");
            icon = "🌧️";
        } else if (code >= 71 && code <= 77) {
            description = t("weatherSnow");
            icon = "❄️";
        } else if (code >= 80 && code <= 82) {
            description = t("weatherShowers");
            icon = "🌦️";
        } else if (code >= 95) {
            description = t("weatherStorm");
            icon = "⛈️";
        }

        document.getElementById("weatherLocation").textContent =
            "Klaipėda";

        document.getElementById("weatherTemp").textContent =
            `${temperature}°C`;

        document.getElementById("weatherDescription").textContent =
            description;

        document.getElementById("weatherIcon").textContent =
            icon;

    } catch (error) {

        document.getElementById("weatherDescription").textContent =
            t("weatherUnavailable");

    }
}

    updateDate();
    loadAccentColor();
    normalizeStoredData();
    syncProjectSelects();
    syncEventRepeatTranslations();
    toggleEventCustomRepeat();
    setLanguage(appLanguage);
    updateQuickAddType();
    renderReminderCenter();
    updateEveningReset();

    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedCalendarDate)) {
        selectedCalendarDate = getDateKey();
        safeStorageSet("selectedCalendarDate", selectedCalendarDate);
    }

    updateNotificationStatus();
    startReminderChecks();

    const searchInput = document.getElementById("globalSearchInput");
    const importInput = document.getElementById("importDataInput");

    if (searchInput) {
        searchInput.addEventListener("input", renderGlobalSearch);
    }

    if (importInput) {
        importInput.addEventListener("change", event => {
            const file = event.target.files?.[0];

            if (file) {
                importTodayData(file);
            }

            event.target.value = "";
        });
    }

    const dailyGoalInput = document.getElementById("dailyGoalInput");

    if (dailyGoalInput) {
        dailyGoalInput.addEventListener("keydown", event => {
            if (event.key === "Enter") {
                saveDailyGoal();
            }
        });
    }

    syncTaskFilterButtons();
    toggleCustomRepeat();
    updateDailyGoal();
    updateWeeklyReview();
    renderTomorrowPlanner();
    updateOverdueNotice();
    renderCalendarWeek();
    renderDayAgenda();
    renderSchedule();
    renderTasks();
const notes = document.getElementById("notes");

loadDailyNote();

notes?.addEventListener("input", () => {
    const value = notes.value;
    const status = document.getElementById("notesSaveStatus");

    if (status) status.textContent = t("noteSaving");

    if (value.trim()) {
        dailyNotes[selectedCalendarDate] = value;
    } else {
        delete dailyNotes[selectedCalendarDate];
    }

    saveDailyNotes();
    renderGlobalSearch();

    clearTimeout(notes.saveStatusTimer);
    notes.saveStatusTimer = setTimeout(() => {
        if (status) status.textContent = t("noteSaved");
    }, 260);
});
function startToday() {
    const welcomeScreen = document.getElementById("welcomeScreen");

    if (welcomeScreen) {
        welcomeScreen.classList.add("hidden");
        welcomeScreen.setAttribute("aria-hidden", "true");
    }

    safeStorageSet("todayWelcomeShown", "true");

    setTimeout(() => {
        if (safeStorageGet("todayOnboardingComplete") === "true") {
            maybeStartControlTour();
        } else {
            openOnboarding();
        }
    }, 220);
}

document.getElementById("welcomeStartButton")?.addEventListener("click", event => {
    event.preventDefault();
    startToday();
});

document.getElementById("taskEditPanel")?.addEventListener("click", event => {
    if (event.target.id === "taskEditPanel") {
        closeTaskEditor();
    }
});

document.getElementById("eventEditPanel")?.addEventListener("click", event => {
    if (event.target.id === "eventEditPanel") {
        closeEventEditor();
    }
});

const controlTourSteps = [
    {
        selector: ".quick-add-card",
        titleKey: "tourQuickTitle",
        textKey: "tourQuickText",
        exampleKey: "tourQuickExample"
    },
    {
        selector: ".focus-card",
        titleKey: "tourFocusTitle",
        textKey: "tourFocusText"
    },
    {
        selector: ".templates-card",
        titleKey: "tourTemplatesTitle",
        textKey: "tourTemplatesText"
    },
    {
        selector: "#progressCard",
        titleKey: "tourStatsTitle",
        textKey: "tourStatsText"
    },
    {
        selector: ".reminder-center",
        titleKey: "tourReminderTitle",
        textKey: "tourReminderText"
    },
    {
        selector: ".add-task",
        titleKey: "tourTaskTitle",
        textKey: "tourTaskText"
    },
    {
        selector: ".search-box",
        titleKey: "tourSearchTitle",
        textKey: "tourSearchText"
    },
    {
        selector: ".tomorrow-planner",
        fallbackSelector: ".evening-reset",
        titleKey: "tourTomorrowTitle",
        textKey: "tourTomorrowText"
    },
    {
        selector: ".calendar-card",
        titleKey: "tourCalendarTitle",
        textKey: "tourCalendarText"
    },
    {
        selector: ".schedule-input",
        titleKey: "tourScheduleTitle",
        textKey: "tourScheduleText"
    },
    {
        selector: ".daily-note-header",
        fallbackSelector: "#notes",
        titleKey: "tourNotesTitle",
        textKey: "tourNotesText"
    },
    {
        selector: ".header-buttons",
        titleKey: "tourSettingsTitle",
        textKey: "tourSettingsText"
    }
];

function clearControlTourTarget() {
    if (controlTourActiveTarget) {
        controlTourActiveTarget.classList.remove("control-tour-target");
        controlTourActiveTarget = null;
    }

    const spotlight = document.getElementById("controlTourSpotlight");
    if (spotlight) {
        spotlight.classList.remove("show");
    }
}

function getControlTourTarget(step) {
    if (!step) return null;

    return (
        document.querySelector(step.selector) ||
        (step.fallbackSelector ? document.querySelector(step.fallbackSelector) : null)
    );
}

function positionControlTourSpotlight(target) {
    const spotlight = document.getElementById("controlTourSpotlight");
    if (!spotlight) return;

    if (!target) {
        spotlight.classList.remove("show");
        return;
    }

    const rect = target.getBoundingClientRect();
    const padding = 7;

    const left = Math.max(6, rect.left - padding);
    const top = Math.max(6, rect.top - padding);
    const right = Math.min(window.innerWidth - 6, rect.right + padding);
    const bottom = Math.min(window.innerHeight - 6, rect.bottom + padding);

    spotlight.style.left = `${left}px`;
    spotlight.style.top = `${top}px`;
    spotlight.style.width = `${Math.max(12, right - left)}px`;
    spotlight.style.height = `${Math.max(12, bottom - top)}px`;
    spotlight.classList.add("show");
}

function positionControlTourCard() {
    const card = document.getElementById("controlTourCard");
    if (!card) return;

    card.style.left = "50%";
    card.style.right = "auto";
    card.style.top = "auto";
    card.style.bottom = window.innerWidth <= 620 ? "14px" : "20px";
    card.style.transform = "translateX(-50%)";
}

function renderControlTourStep() {
    const overlay = document.getElementById("controlTourOverlay");
    if (!overlay?.classList.contains("open")) return;

    const step = controlTourSteps[controlTourIndex];
    if (!step) {
        finishControlTour();
        return;
    }

    clearControlTourTarget();

    const target = getControlTourTarget(step);

    if (target) {
        controlTourActiveTarget = target;
        target.classList.add("control-tour-target");
        target.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "auto"
                : "smooth",
            block: "center",
            inline: "nearest"
        });
    }

    const guideCard = document.getElementById("controlTourCard");

    if (
        guideCard &&
        !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
        guideCard.classList.remove("control-tour-step-animate");
        void guideCard.offsetWidth;
        guideCard.classList.add("control-tour-step-animate");
    }

    setText("controlTourTitle", t(step.titleKey));
    setText("controlTourText", t(step.textKey));
    setText(
        "controlTourStepLabel",
        tr("guideStep", {
            current: controlTourIndex + 1,
            total: controlTourSteps.length
        })
    );

    const example = document.getElementById("controlTourExample");

    if (example) {
        if (step.exampleKey) {
            example.textContent = t(step.exampleKey);
            example.classList.add("show");
        } else {
            example.textContent = "";
            example.classList.remove("show");
        }
    }

    const back = document.getElementById("controlTourBackButton");
    const next = document.getElementById("controlTourNextButton");

    if (back) {
        back.disabled = controlTourIndex === 0;
        back.style.visibility = controlTourIndex === 0 ? "hidden" : "visible";
        back.textContent = t("guideBack");
    }

    if (next) {
        next.textContent =
            controlTourIndex === controlTourSteps.length - 1
                ? t("guideFinish")
                : t("guideNext");
    }

    requestAnimationFrame(() => {
        positionControlTourSpotlight(target);
        positionControlTourCard();
    });

    setTimeout(() => {
        if (
            document.getElementById("controlTourOverlay")?.classList.contains("open") &&
            controlTourActiveTarget === target
        ) {
            positionControlTourSpotlight(target);
        }
    }, 360);
}

function startControlTour(startIndex = 0) {
    const overlay = document.getElementById("controlTourOverlay");
    if (!overlay) return;

    // Do not put the tour behind Settings or onboarding.
    document.getElementById("settingsPanel")?.classList.remove("open");
    document.getElementById("onboardingPanel")?.classList.remove("open");

    controlTourIndex = Math.min(
        Math.max(0, Number(startIndex) || 0),
        controlTourSteps.length - 1
    );

    overlay.classList.add("open");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("control-tour-active");

    renderControlTourStep();

    setTimeout(() => {
        document.getElementById("controlTourNextButton")?.focus();
    }, 320);
}

function restartControlTour() {
    safeStorageRemove("todayControlTourComplete");
    startControlTour(0);
}

function maybeStartControlTour() {
    if (safeStorageGet("todayControlTourComplete") === "true") return;
    if (safeStorageGet("todayOnboardingComplete") !== "true") return;

    const welcome = document.getElementById("welcomeScreen");
    if (welcome && !welcome.classList.contains("hidden")) return;

    setTimeout(() => startControlTour(0), 450);
}

function nextControlTourStep() {
    if (controlTourIndex >= controlTourSteps.length - 1) {
        finishControlTour();
        return;
    }

    controlTourIndex++;
    renderControlTourStep();
}

function previousControlTourStep() {
    if (controlTourIndex <= 0) return;

    controlTourIndex--;
    renderControlTourStep();
}

function finishControlTour() {
    clearControlTourTarget();

    const overlay = document.getElementById("controlTourOverlay");
    overlay?.classList.remove("open");
    overlay?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("control-tour-active");

    safeStorageSet("todayControlTourComplete", "true");
}

window.addEventListener("resize", () => {
    if (!document.getElementById("controlTourOverlay")?.classList.contains("open")) {
        return;
    }

    positionControlTourSpotlight(controlTourActiveTarget);
    positionControlTourCard();
});

window.addEventListener("scroll", () => {
    if (!document.getElementById("controlTourOverlay")?.classList.contains("open")) {
        return;
    }

    positionControlTourSpotlight(controlTourActiveTarget);
}, true);

document.addEventListener("keydown", event => {
    if (!document.getElementById("controlTourOverlay")?.classList.contains("open")) {
        return;
    }

    if (event.key === "Escape") {
        finishControlTour();
    } else if (event.key === "ArrowRight" || event.key === "Enter") {
        if (
            event.target?.tagName !== "BUTTON" ||
            event.target?.id === "controlTourNextButton"
        ) {
            nextControlTourStep();
        }
    } else if (event.key === "ArrowLeft") {
        previousControlTourStep();
    }
});

function updateOnboardingTranslations() {
    setText("onboardingWelcomeTitle", t("onboardWelcomeTitle"));
    setText("onboardingWelcomeText", t("onboardWelcomeText"));
    setText("onboardingLanguageLabel", t("onboardLanguage"));
    setText("onboardingGoalTitle", t("onboardGoalTitle"));
    setText("onboardingGoalText", t("onboardGoalText"));
    setText("onboardingGoalLabel", t("onboardGoalLabel"));
    setText("onboardingStyleTitle", t("onboardStyleTitle"));
    setText("onboardingStyleText", t("onboardStyleText"));
    setText("onboardingAccentLabel", t("onboardAccent"));
    setText("onboardingSkipButton", t("skip"));
    setText(
        "onboardingNextButton",
        onboardingStep === 2 ? t("finish") : t("next")
    );
}

function renderOnboardingStep() {
    document.querySelectorAll("[data-onboarding-step]").forEach(step => {
        step.classList.toggle(
            "active",
            Number(step.dataset.onboardingStep) === onboardingStep
        );
    });

    document.querySelectorAll("[data-onboarding-dot]").forEach(dot => {
        dot.classList.toggle(
            "active",
            Number(dot.dataset.onboardingDot) <= onboardingStep
        );
    });

    updateOnboardingTranslations();
}

function openOnboarding() {
    if (safeStorageGet("todayOnboardingComplete") === "true") return;

    const panel = document.getElementById("onboardingPanel");
    const language = document.getElementById("onboardingLanguage");
    const goal = document.getElementById("onboardingGoal");
    const accent = document.getElementById("onboardingAccent");

    if (language) language.value = appLanguage;
    if (goal) goal.value = dailyGoal;
    if (accent) accent.value = accentColor;

    onboardingStep = 0;
    renderOnboardingStep();
    panel?.classList.add("open");
}

function skipOnboarding() {
    safeStorageSet("todayOnboardingComplete", "true");
    document.getElementById("onboardingPanel")?.classList.remove("open");
    maybeStartControlTour();
}

function nextOnboardingStep() {
    if (onboardingStep === 0) {
        const language = document.getElementById("onboardingLanguage")?.value || "en";
        setLanguage(language);
    }

    if (onboardingStep === 1) {
        const goal = Math.min(
            50,
            Math.max(
                1,
                Number(document.getElementById("onboardingGoal")?.value) || 3
            )
        );

        dailyGoal = goal;
        safeStorageSet("dailyGoal", String(dailyGoal));
        updateDailyGoal();
    }

    if (onboardingStep === 2) {
        const accent = document.getElementById("onboardingAccent")?.value || "graphite";
        setAccentColor(accent);

        safeStorageSet("todayOnboardingComplete", "true");
        document.getElementById("onboardingPanel")?.classList.remove("open");
        maybeStartControlTour();
        return;
    }

    onboardingStep++;
    renderOnboardingStep();
}

window.addEventListener("load", () => {
    const welcomeScreen = document.getElementById("welcomeScreen");

    const hour = new Date().getHours();
    const greeting = document.getElementById("welcomeGreeting");
    const icon = document.getElementById("welcomeIcon");

    if (hour >= 5 && hour < 12) {
        greeting.textContent = t("morning").replace(/\s[☀️🌤️🌙]+$/u, "");
        icon.textContent = "☀️";
    } else if (hour >= 12 && hour < 18) {
        greeting.textContent = t("afternoon").replace(/\s[☀️🌤️🌙]+$/u, "");
        icon.textContent = "🌤️";
    } else {
        greeting.textContent = t("evening").replace(/\s[☀️🌤️🌙]+$/u, "");
        icon.textContent = "🌙";
    }

    if (safeStorageGet("todayWelcomeShown") === "true") {
        welcomeScreen.classList.add("hidden");
    }
    updateSettingsThemeButton();
    updateInstallUI();

    setTimeout(() => {
        if (!welcomeScreen.classList.contains("hidden")) return;

        if (safeStorageGet("todayOnboardingComplete") === "true") {
            maybeStartControlTour();
        } else {
            openOnboarding();
        }
    }, 350);
});
function updateSettingsThemeButton() {
    const button = document.getElementById("settingsThemeButton");

    if (!button) return;

    if (document.body.classList.contains("dark")) {
        button.textContent = "☀️";
        button.title = "Switch to light mode";
    } else {
        button.textContent = "🌙";
        button.title = "Switch to dark mode";
    }
}
function isIosDevice() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandaloneMode() {
    return window.matchMedia?.("(display-mode: standalone)")?.matches ||
        window.navigator.standalone === true;
}

function updateInstallUI() {
    const text = document.getElementById("installCardText");
    const button = document.getElementById("installAppButton");

    if (!text || !button) return;

    if (isStandaloneMode()) {
        text.textContent = t("installUnavailable");
        button.style.display = "none";
        return;
    }

    button.style.display = "";

    if (deferredInstallPrompt) {
        text.textContent = t("installAvailable");
    } else if (isIosDevice()) {
        text.textContent = t("installIos");
    } else {
        text.textContent = t("installUnavailable");
    }
}

async function installTodayApp() {
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();

        try {
            await deferredInstallPrompt.userChoice;
        } catch (error) {
            // No action needed.
        }

        deferredInstallPrompt = null;
        updateInstallUI();
        return;
    }

    if (isIosDevice()) {
        alert(t("installIos"));
    } else {
        alert(t("installUnavailable"));
    }
}

window.addEventListener("beforeinstallprompt", event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    updateInstallUI();
});

window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    updateInstallUI();
});

function toggleSettings() {
    const panel = document.getElementById("settingsPanel");
    panel.classList.toggle("open");

    const accentSelect = document.getElementById("accentSelect");
    if (accentSelect) {
        accentSelect.value = accentColor;
    }

    const languageSelect = document.getElementById("languageSelect");
    if (languageSelect) {
        languageSelect.value = appLanguage;
    }
}
// Expose only version metadata for debugging; app state remains internal globals.

document.addEventListener("keydown", event => {
    const target = event.target;
    const tag = target?.tagName;

    const typing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable;

    const modalOpen =
        document.querySelector(".editor-panel.open") ||
        document.getElementById("settingsPanel")?.classList.contains("open") ||
        document.getElementById("onboardingPanel")?.classList.contains("open") ||
        document.getElementById("controlTourOverlay")?.classList.contains("open");

    if (
        event.key === "/" &&
        !typing &&
        !modalOpen &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
    ) {
        event.preventDefault();

        const quick = document.getElementById("quickAddInput");
        if (quick) {
            quick.scrollIntoView({ behavior: "smooth", block: "center" });
            setTimeout(() => quick.focus(), 180);
        }
    }
});

window.TodayVersion = {
    app: TODAY_APP_VERSION,
    data: TODAY_DATA_VERSION
};

const appVersionLabel = document.getElementById("appVersionLabel");
if (appVersionLabel) {
    appVersionLabel.textContent = `Today · ${TODAY_APP_VERSION} · data v${TODAY_DATA_VERSION}`;
}

/* Today — PWA / connectivity + update helper */

function showPwaStatus(message, ms = 2600) {
    const status = document.getElementById("pwaStatus");
    if (!status) return;

    status.textContent = message;
    status.style.display = "block";

    clearTimeout(window.todayPwaStatusTimer);
    window.todayPwaStatusTimer = setTimeout(() => {
        status.style.display = "none";
    }, ms);
}

function showPwaUpdate(worker) {
    if (!worker) return;

    pendingTodayServiceWorker = worker;

    const banner = document.getElementById("pwaUpdateBanner");
    if (banner) banner.classList.add("show");

    const versionStatus = document.getElementById("versionStatus");
    if (versionStatus) versionStatus.textContent = t("updateReadyText");
}

function dismissPwaUpdate() {
    document.getElementById("pwaUpdateBanner")?.classList.remove("show");
}

function applyPwaUpdate() {
    if (!pendingTodayServiceWorker) return;

    todayReloadingForUpdate = true;
    pendingTodayServiceWorker.postMessage({ type: "SKIP_WAITING" });
}

async function checkForAppUpdate() {
    const status = document.getElementById("versionStatus");

    if (
        !("serviceWorker" in navigator) ||
        location.protocol === "file:" ||
        !todayServiceWorkerRegistration
    ) {
        if (status) status.textContent = t("updateCheckUnavailable");
        return;
    }

    if (status) status.textContent = t("checkingUpdate");

    try {
        await todayServiceWorkerRegistration.update();

        if (todayServiceWorkerRegistration.waiting) {
            showPwaUpdate(todayServiceWorkerRegistration.waiting);
            return;
        }

        // Give an installing worker a moment to reach installed/waiting.
        await new Promise(resolve => setTimeout(resolve, 650));

        if (todayServiceWorkerRegistration.waiting) {
            showPwaUpdate(todayServiceWorkerRegistration.waiting);
        } else if (status) {
            status.textContent = t("upToDate");
        }
    } catch (error) {
        if (status) status.textContent = t("updateCheckUnavailable");
    }
}

function wireServiceWorkerUpdate(registration) {
    todayServiceWorkerRegistration = registration;

    if (registration.waiting && navigator.serviceWorker.controller) {
        showPwaUpdate(registration.waiting);
    }

    registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;

        installing.addEventListener("statechange", () => {
            if (
                installing.state === "installed" &&
                navigator.serviceWorker.controller
            ) {
                showPwaUpdate(installing);
            }
        });
    });
}

(function () {
    function updateOnlineStatus() {
        if (!navigator.onLine) {
            showPwaStatus(t("offlineStatus"), 4500);
        }
    }

    window.addEventListener("offline", updateOnlineStatus);
    window.addEventListener("online", () => showPwaStatus(t("onlineStatus"), 1800));

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
        window.addEventListener("load", async () => {
            try {
                const registration = await navigator.serviceWorker.register(
                    "./service-worker.js"
                );

                wireServiceWorkerUpdate(registration);
            } catch (error) {
                // Today still works without service worker support.
            }
        });

        navigator.serviceWorker.addEventListener("controllerchange", () => {
            if (todayReloadingForUpdate) {
                window.location.reload();
            }
        });
    }

    updateOnlineStatus();
})();

const assetLoadWarning = document.getElementById("assetLoadWarning");
if (assetLoadWarning) assetLoadWarning.remove();

initializeCloudSync();

