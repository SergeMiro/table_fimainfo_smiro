/**
 * lib_table_fimainfo_smiro_vanilla.js
 * Version Vanilla JS COMPLETE (sans jQuery) de la bibliothèque de table
 * Basée sur lib_table_fimainfo_smiro.js avec toutes les fonctionnalités
 * 
 * Toutes les options supportées:
 * - enableSearch: true/false - Recherche globale
 * - enableFilters: true/false - Filtres par colonne  
 * - enableColumnToggle: true/false - Basculement d'affichage des colonnes
 * - enableTooltip: true/false - Tooltips
 * - enablePageSizeSelector: true/false - Sélecteur de taille de page
 * - enableActionButton: true/false - Bouton d'action "Voir la fiche"
 * - itemsPerPageCount: number - Nombre d'éléments par page par défaut
 * - includedColumns: array avec "key as alias" - Colonnes à inclure
 * - excludedColumns: array - Colonnes à exclure
 * - colorPalette: [headerBg, buttonBg] - Palette de couleurs
 * - badgeColumns: array - Colonnes avec badges
 * - badgeCounts: array - Colonnes avec comptage de badges
 * - orderByColumns: true/false - Tri des colonnes
 * - virtualize: true/false - Virtualisation pour grandes tables
 * - virtualizeThreshold: number - Seuil de virtualisation
 * - theme: 'default'/'dark'/'light' - Thème
 * - legacyShim: true/false - Compatibilité legacy
 *
 * Требования: moment.js должен быть подключён.
 */

/* ====== CORE (per-instance state) - IDENTIQUE ====== */
const INSTANCES = new Map();
function idp(cid, name) { return `${cid}__${name}`; }
function getInstanceState(cid) {
	if (!cid) throw new Error('containerId is required');
	if (!INSTANCES.has(cid)) {
		INSTANCES.set(cid, {
			currentData: [],
			filteredData: [],
			currentPage: 1,
			itemsPerPage: 10,
			visibleColumns: {},
			columnDefinitions: {},
			sortState: {},
			options: {},
			selectedIndice: null,
			lastTel: null,
			virtualRowHeight: 42,
			virtualBuffer: 6,
			callbacks: {} // onRowSelect, onRowDblClick, onReady, onRenderComplete, onExport
		});
	}
	return INSTANCES.get(cid);
}

/* ====== Themes & utils - IDENTIQUE ====== */
const colorThemes = {
	default: { headerBg: 'bg-gray-50', buttonBg: 'bg-blue-600', buttonHover: 'hover:bg-blue-700', badgeBase: 'bg-blue-100 text-blue-800' },
	dark: { headerBg: 'bg-slate-800', buttonBg: 'bg-slate-600', buttonHover: 'hover:bg-slate-700', badgeBase: 'bg-slate-100 text-slate-800' },
	light: { headerBg: 'bg-sky-50', buttonBg: 'bg-sky-600', buttonHover: 'hover:bg-sky-700', badgeBase: 'bg-sky-100 text-sky-800' }
};
function escapeAttr(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function generateHoverClass(bg) { const m = (bg || '').match(/bg-(\w+)-(\d+)/); if (m) { const c = m[1], sh = +m[2]; return `hover:bg-${c}-${Math.min(900, sh + 100)}`; } return 'hover:bg-gray-700'; }
function getCurrentPalette(options) { if (options && options.customPalette) return options.customPalette; return colorThemes[(options && options.theme) || 'default'] || colorThemes.default; }

/* ====== Date formatting helper ====== */
function formatDateValue(val) {
	if (!val) return '';

	const originalStr = String(val);

	// Проверяем, есть ли время в исходном значении
	const hasTime = originalStr.includes(':') || originalStr.includes('T') || /\d{2}:\d{2}/.test(originalStr);

	// Проверяем, есть ли дата в исходном значении
	const hasDate = originalStr.includes('-') || originalStr.includes('/') || /\d{4}/.test(originalStr);

	// Если это не похоже на дату, возвращаем как есть
	if (!hasDate && !hasTime) {
		return originalStr;
	}

	let mm;

	// Пробуем разные форматы для парсинга
	if (originalStr.includes('/')) {
		// Формат YYYY/MM/DD или DD/MM/YYYY
		if (/^\d{4}\/\d{2}\/\d{2}/.test(originalStr)) {
			mm = moment(originalStr, 'YYYY/MM/DD HH:mm');
		} else if (/^\d{2}\/\d{2}\/\d{4}/.test(originalStr)) {
			mm = moment(originalStr, 'DD/MM/YYYY HH:mm');
		} else {
			mm = moment(originalStr);
		}
	} else if (originalStr.includes('-')) {
		// Формат YYYY-MM-DD
		mm = moment(originalStr, 'YYYY-MM-DD HH:mm');
	} else {
		// Другие форматы
		mm = moment(originalStr);
	}

	// Если парсинг не удался, возвращаем исходное значение
	if (!mm.isValid()) {
		return originalStr;
	}

	if (hasDate && hasTime) {
		// Есть и дата и время - показываем в формате день/месяц/год час:минуты
		return mm.format('DD/MM/YYYY HH:mm');
	} else if (hasDate && !hasTime) {
		// Только дата - показываем только дату
		return mm.format('DD/MM/YYYY');
	} else if (!hasDate && hasTime) {
		// Только время - показываем только время
		return mm.format('HH:mm');
	} else {
		// Неопределенный формат - возвращаем как есть
		return originalStr;
	}
}

/* ====== Phone number detection helper ====== */
function isPhoneNumber(value) {
	if (!value) return false;
	const str = String(value);
	// Проверяем, содержит ли строка цифры и пробелы/тире, характерные для телефонных номеров
	return /^[\d\s\-\.\+\(\)]{8,}$/.test(str) && /\d{2,}/.test(str);
}

function normalizePhoneForSearch(value) {
	if (!value) return '';
	return String(value).replace(/[\s\-\.\(\)]/g, '');
}

/* ====== Column detection with 'as' support - IDENTIQUE ====== */
function generateColumnDefinitions(sqlData, options = {}) {
	if (!sqlData || sqlData.length === 0) return { columns: {}, visibility: {} };
	const firstRow = sqlData[0];
	const columns = {};
	const visibility = {};
	const excludedColumns = options.excludedColumns || [];
	const includedColumns = options.includedColumns || [];
	const normalize = (s) => String(s || '').toLowerCase().replace(/\s+/g, '_').replace(/-+/g, '_');
	const findDataKey = (name) => {
		if (!name) return null;
		const nq = normalize(name);
		let found = Object.keys(firstRow).find(k => k.toLowerCase() === name.toLowerCase() || normalize(k) === nq);
		if (found) return found;
		found = Object.keys(firstRow).find(k => normalize(k).includes(nq) || nq.includes(normalize(k)));
		return found || null;
	};

	if (includedColumns.length > 0) {
		includedColumns.forEach((colEntry) => {
			let src = String(colEntry || '').trim(), alias = null;
			const m = src.match(/(.+?)\s+as\s+(.+)/i);
			if (m) { src = m[1].trim(); alias = m[2].trim(); }
			let dataKey = findDataKey(src) || (alias ? findDataKey(alias) : null);
			if (!dataKey) { console.warn('Colonne non trouvée:', colEntry); return; }
			const columnKey = normalize(dataKey);
			const label = (alias ? alias : dataKey).replace(/_/g, ' ').replace(/-/g, ' ').toUpperCase();
			columns[columnKey] = { key: dataKey, label, width: 'w-32', requested: colEntry, alias: alias || null };
			visibility[columnKey] = true;
		});
	} else {
		Object.keys(firstRow).forEach((key) => {
			const columnKey = normalize(key);
			let include = true;
			if (excludedColumns.length > 0) include = !excludedColumns.includes(key) && !excludedColumns.includes(columnKey);
			if (include) { columns[columnKey] = { key, label: key.replace(/[-_]/g, ' ').toUpperCase(), width: 'w-32' }; visibility[columnKey] = true; }
		});
	}
	return { columns, visibility };
}

/* ====== Persistence - IDENTIQUE ====== */
function persistSettings(cid, state) {
	try {
		localStorage.setItem(`table_settings_${cid}`, JSON.stringify({ visibleColumns: state.visibleColumns, itemsPerPage: state.itemsPerPage }));
	} catch (e) { }
}
function loadPersistedSettings(cid) {
	try {
		const raw = localStorage.getItem(`table_settings_${cid}`); if (!raw) return null; return JSON.parse(raw);
	} catch (e) { return null; }
}

/* ====== Floating UI tooltip - Version Corrigée ====== */
function initializeFloatingUITooltips() {
	if (!window.FloatingUIDOM) return;

	try {
		// Accès direct aux méthodes de Floating UI
		const computePosition = window.FloatingUIDOM.computePosition;
		const autoUpdate = window.FloatingUIDOM.autoUpdate;
		const offset = window.FloatingUIDOM.offset;
		const flip = window.FloatingUIDOM.flip;
		const shift = window.FloatingUIDOM.shift;
		const hideMw = window.FloatingUIDOM.hide;
		const arrow = window.FloatingUIDOM.arrow;

		if (!computePosition || !offset || !flip || !shift) {
			console.warn('Floating UI: Fonctions manquantes détectées');
			return;
		}

		console.log('✅ Floating UI initialisé avec succès');

		const ATTR = 'data-tooltip';
		const ATTR_PLACEMENT = 'data-placement';

		let cleanup = null;
		let currentRef = null;

		const tooltip = document.createElement('div');
		tooltip.setAttribute('role', 'tooltip');
		tooltip.id = 'tw-tooltip';
		tooltip.className = [
			'pointer-events-none select-none z-[9999]',
			'rounded-xl px-3 py-2 text-sm font-medium',
			'bg-white/90 backdrop-blur-md shadow-xl border border-white/30',
			'text-gray-900',
			'opacity-0 translate-y-1 transition-opacity duration-150 ease-out',
		].join(' ');
		tooltip.style.position = 'fixed';
		tooltip.style.maxWidth = '50vw';

		const arrowEl = document.createElement('div');
		arrowEl.setAttribute('data-arrow', '');
		arrowEl.className = 'absolute w-2 h-2 rotate-45 bg-white/90 backdrop-blur-md border-r border-b border-white/30';
		tooltip.appendChild(arrowEl);
		document.body.appendChild(tooltip);

		function show(ref) {
			const content = ref.getAttribute(ATTR);
			if (!content) return;

			tooltip.textContent = '';
			const span = document.createElement('span');
			span.textContent = content;
			tooltip.appendChild(span);
			tooltip.appendChild(arrowEl);
			tooltip.style.display = 'block';

			if (cleanup) cleanup();
			cleanup = autoUpdate(ref, tooltip, async () => {
				const placement = ref.getAttribute(ATTR_PLACEMENT) || 'top';
				const result = await computePosition(ref, tooltip, {
					strategy: 'fixed',
					placement,
					middleware: [
						window.FloatingUIDOM.offset(8),
						window.FloatingUIDOM.flip(),
						window.FloatingUIDOM.shift({ padding: 8 }),
						window.FloatingUIDOM.hide(),
						window.FloatingUIDOM.arrow({ element: arrowEl })
					],
				});
				const x = result.x;
				const y = result.y;
				const finalPlacement = result.placement;
				const middlewareData = result.middlewareData;
				tooltip.style.left = `${x}px`;
				tooltip.style.top = `${y}px`;

				const hideData = middlewareData.hide || {};
				const isHidden = hideData.referenceHidden || hideData.escaped;
				tooltip.style.opacity = isHidden ? '0' : '1';
				tooltip.style.transform = isHidden ? 'translateY(4px)' : 'translateY(0)';

				const staticSide = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }[finalPlacement.split('-')[0]];
				Object.assign(arrowEl.style, { left: '', right: '', top: '', bottom: '' });
				arrowEl.style[staticSide] = `-6px`;

				const arrowData = middlewareData.arrow || {};
				const ax = arrowData.x || 0;
				const ay = arrowData.y || 0;
				if (finalPlacement.startsWith('top') || finalPlacement.startsWith('bottom')) {
					arrowEl.style.left = `${ax}px`; arrowEl.style.top = ''; arrowEl.style.transform = 'translateX(-50%) rotate(45deg)';
				} else {
					arrowEl.style.top = `${ay}px`; arrowEl.style.left = ''; arrowEl.style.transform = 'translateY(-50%) rotate(45deg)';
				}
			});
		}
		function hideTooltip() {
			if (cleanup) { cleanup(); cleanup = null; }
			currentRef = null;
			tooltip.style.opacity = '0';
			tooltip.style.display = 'none';
			tooltip.textContent = '';
			tooltip.appendChild(arrowEl);
		}

		document.addEventListener('mouseover', (e) => {
			const ref = e.target.closest(`[${ATTR}]`); if (!ref) return;
			if (currentRef === ref) return; currentRef = ref; show(ref);
		});
		document.addEventListener('mouseout', (e) => {
			if (!currentRef) return;
			const to = e.relatedTarget;
			if (to && (currentRef.contains(to) || tooltip.contains(to))) return;
			hideTooltip();
		});
		document.addEventListener('focusin', (e) => {
			const ref = e.target.closest(`[${ATTR}]`); if (ref) { currentRef = ref; show(ref); }
		});
		document.addEventListener('focusout', (e) => {
			const to = e.relatedTarget;
			if (to && (currentRef?.contains(to) || tooltip.contains(to))) return;
			hideTooltip();
		});
		document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTooltip(); });

	} catch (error) {
		console.warn('Erreur d\'initialisation des tooltips Floating UI:', error);
	}
}

// Simple tooltip fallback
function initializeSimpleTooltips() {
	console.log('Initialisation des tooltips simples...');

	if (document.getElementById('simple-tooltip')) {
		document.getElementById('simple-tooltip').remove();
	}

	const tooltip = document.createElement('div');
	tooltip.id = 'simple-tooltip';
	tooltip.className = [
		'pointer-events-none select-none z-[9999] fixed',
		'rounded-lg px-3 py-2 text-sm font-medium max-w-xs',
		'bg-gray-900 text-white shadow-lg',
		'opacity-0 transition-opacity duration-200',
		'whitespace-normal break-words'
	].join(' ');
	document.body.appendChild(tooltip);

	let currentElement = null;

	function showTooltip(element) {
		const content = element.getAttribute('data-tooltip');
		if (!content) return;

		tooltip.textContent = content;
		tooltip.style.opacity = '1';
		tooltip.style.display = 'block';

		const rect = element.getBoundingClientRect();
		const tooltipRect = tooltip.getBoundingClientRect();

		let top = rect.top - tooltipRect.height - 8;
		let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

		if (top < 8) {
			top = rect.bottom + 8;
		}
		if (left < 8) {
			left = 8;
		}
		if (left + tooltipRect.width > window.innerWidth - 8) {
			left = window.innerWidth - tooltipRect.width - 8;
		}

		tooltip.style.top = top + 'px';
		tooltip.style.left = left + 'px';
	}

	function hideTooltip() {
		tooltip.style.opacity = '0';
		setTimeout(() => {
			if (tooltip.style.opacity === '0') {
				tooltip.style.display = 'none';
			}
		}, 200);
		currentElement = null;
	}

	document.addEventListener('mouseover', (e) => {
		const element = e.target.closest('[data-tooltip]');
		if (element && element !== currentElement) {
			currentElement = element;
			showTooltip(element);
		}
	});

	document.addEventListener('mouseout', (e) => {
		const element = e.target.closest('[data-tooltip]');
		if (element && !element.contains(e.relatedTarget)) {
			hideTooltip();
		}
	});
}

function ensureFloatingUITooltipsOnce() {
	if (window.__fimainfoFloatingUITooltipInitialized) return;

	try {
		if (window.FloatingUIDOM &&
			typeof window.FloatingUIDOM.computePosition === 'function' &&
			typeof window.FloatingUIDOM.offset === 'function') {
			console.log('Tentative d\'initialisation Floating UI...');
			window.__fimainfoFloatingUITooltipInitialized = true;
			initializeFloatingUITooltips();
		} else {
			console.log('Floating UI non disponible ou incomplet, utilisation des tooltips simples');
			window.__fimainfoFloatingUITooltipInitialized = true;
			initializeSimpleTooltips();
		}
	} catch (error) {
		console.warn('Erreur d\'initialisation Floating UI:', error);
		console.log('Fallback vers tooltips simples');
		window.__fimainfoFloatingUITooltipInitialized = true;
		initializeSimpleTooltips();
	}
}

/* ====== Shell render per-instance - CONVERTI VANILLA JS ====== */
function afficheRechercheTableau(options = {}) {
	if (!options.containerId) { console.error('afficheRechercheTableau: containerId required'); return; }
	const cid = options.containerId;
	const state = getInstanceState(cid);
	state.options = options;
	state.itemsPerPage = options.itemsPerPageCount || state.itemsPerPage;

	const container = document.getElementById(cid);
	if (!container) { console.error(`Container #${cid} not found`); return; }
	container.innerHTML = '';

	const persisted = loadPersistedSettings(cid);
	if (persisted) {
		if (persisted.visibleColumns) state.visibleColumns = persisted.visibleColumns;
		if (persisted.itemsPerPage) state.itemsPerPage = persisted.itemsPerPage;
	}

	const palette = getCurrentPalette(options);
	const minWidth = (options.includedColumns && options.includedColumns.length ? options.includedColumns.length : 8) * 140;

	container.insertAdjacentHTML('beforeend', `
    <div class="bg-white rounded-lg shadow-sm border border-gray-200 w-full mx-auto">
      <!-- Header -->
      <div class="px-4 py-4 border-b border-gray-200 ${palette.headerBg}">
        <div class="flex items-center justify-between">
          ${options.enableSearch !== false ? `
            <div class="flex-1 max-w-md mr-4">
              <div class="relative">
                <input type="text" id="${idp(cid, 'global_search')}" placeholder="Rechercher dans tous les champs affichés ..." class="pl-8 pr-3 py-1.5 border border-gray-300 rounded-md text-sm w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                <svg class="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              </div>
            </div>` : ''}
          ${options.enableColumnToggle !== false ? `
            <div class="flex items-center space-x-2 gap-4">
				   <div class="flex items-center space-x-2 ml-2">
                <button id="${idp(cid, 'export_csv')}" class="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer" data-tooltip="Exporter en CSV">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                </button>
                <button id="${idp(cid, 'export_xls')}" class="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 cursor-pointer" data-tooltip="Exporter en XLSX">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 011.414.414l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                </button>
              </div>
              <div class="relative">
                <button id="${idp(cid, 'columns_toggle')}" class="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                  <svg class="w-4 h-4 mr-1.5" fill="none" stroke-width="1.5" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12a7.5 7.5 0 0 0 15 0m-15 0a7.5 7.5 0 1 1 15 0m-15 0H3m16.5 0H21m-1.5 0H12m-8.457 3.077 1.41-.513m14.095-5.13 1.41-.513M5.106 17.785l1.15-.964m11.49-9.642 1.149-.964M7.501 19.795l.75-1.3m7.5-12.99.75-1.3m-6.063 16.658.26-1.477m2.605-14.772.26-1.477m0 17.726-.26-1.477M10.698 4.614l-.26-1.477M16.5 19.794l-.75-1.299M7.5 4.205 12 12m6.894 5.785-1.149-.964M6.256 7.178l-1.15-.964m15.352 8.864-1.41-.513M4.954 9.435l-1.41-.514M12.002 12l-3.75 6.495"></path>
                  </svg>
                  Colonnes
                  <svg class="w-4 h-4 ml-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
                </button>
                <div id="${idp(cid, 'columns_dropdown')}" class="hidden absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg border border-gray-200 z-50">
                  <div class="py-2">
                    <div id="${idp(cid, 'column_dropdown_title')}" class="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100">Colonnes affichées</div>
                    <div id="${idp(cid, 'column_checkboxes')}" class="py-1"></div>
                  </div>
                </div>
              </div>

            </div>` : ''}
        </div>
        <script>
          // Initialiser les tooltips Floating UI après le rendu des boutons
          setTimeout(() => {
            ensureFloatingUITooltipsOnce();
          }, 100);
        </script>
      </div>

      <!-- Filters -->
      ${options.enableFilters !== false ? `
      <div id="${idp(cid, 'filters_container')}" class="px-4 py-4 bg-gray-50 border-b border-gray-200">
        <div id="${idp(cid, 'filters_grid')}" class="grid gap-3"></div>
      </div>` : ''}

      <!-- Summary -->
      <div class="px-3 py-3 bg-gray-50 border-b border-gray-200">
        <div class="flex items-center justify-between">
          <span id="${idp(cid, 'results_count')}" class="text-sm text-gray-600">0 résultats sur 0</span>
          <span id="${idp(cid, 'results_summary')}" class="text-sm text-blue-600">Affichage de 0 à 0 sur 0 résultats</span>
        </div>
      </div>

      <!-- Loading -->
      <div id="${idp(cid, 'loading-spinner')}" class="hidden px-4 py-12"><div class="flex justify-center items-center"><div class="animate-spin rounded-lg h-8 w-8 border-b-2 border-blue-500"></div></div></div>

      <!-- Table -->
      <div id="${idp(cid, 'table_container')}" class="overflow-x-auto" style="max-height:520px; scrollbar-width:thin; scrollbar-color:#cbd5e0 #f7fafc;">
        <style>
          #${idp(cid, 'table_container')}::-webkit-scrollbar{height:6px;}
          #${idp(cid, 'table_container')}::-webkit-scrollbar-track{background:#f7fafc;border-radius:3px;}
          #${idp(cid, 'table_container')}::-webkit-scrollbar-thumb{background:#cbd5e0;border-radius:3px;}
          #${idp(cid, 'table_container')}::-webkit-scrollbar-thumb:hover{background:#a0aec0;}
        </style>
        <table style="width:100%; table-layout:fixed; min-width:${minWidth}px;">
          <thead id="${idp(cid, 'table_head')}" class="bg-gray-50"></thead>
          <tbody id="${idp(cid, 'table_body')}" class="bg-white divide-y divide-gray-200"></tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div class="px-4 py-4 bg-gray-50 border-t border-gray-200">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-4">
            ${options.enablePageSizeSelector !== false ? `
            <div class="flex items-center space-x-2">
              <label for="${idp(cid, 'page_size_selector')}" class="text-sm text-gray-700">Éléments par page:</label>
              <div class="relative">
                <select id="${idp(cid, 'page_size_selector')}" class="text-sm border border-gray-300 rounded px-2 py-1 pr-6 focus:outline-none focus:ring-1 focus:ring-blue-500 appearance-none">
                  ${[5, 10, 20, 50, 100].map(s => `<option value="${s}" ${state.itemsPerPage === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
                <svg class="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
              </div>
            </div>` : ''}
            <div class="text-sm text-gray-700">Page <span id="${idp(cid, 'current_page')}">1</span> sur <span id="${idp(cid, 'total_pages')}">1</span></div>
          </div>
          <div class="flex space-x-2">
            <button id="${idp(cid, 'prev_page')}" class="inline-flex items-center px-2 py-1 text-xs font-medium text-gray-500 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
              <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg> Précédent
            </button>
            <div id="${idp(cid, 'page_numbers')}" class="flex space-x-1"></div>
            <button id="${idp(cid, 'next_page')}" class="inline-flex items-center px-2 py-1 text-xs font-medium text-gray-500 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed">
              Suivant <svg class="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Actions -->
      ${options.enableActionButton !== false ? `
      <div class="px-4 py-4 border-t border-gray-200">
        <button id="${idp(cid, 'btn_fiche')}" class="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white ${palette.buttonBg} border border-transparent rounded-md ${palette.buttonHover} disabled:opacity-50 disabled:cursor-not-allowed" disabled>
          <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
          Voir la fiche
        </button>
      </div>` : ''}
    </div>
  `);

	initializeTableEventListenersForInstance(cid);
	ensureFloatingUITooltipsOnce();

	if (typeof state.callbacks.onReady === 'function') {
		try { state.callbacks.onReady(getPublicInstanceApi(cid)); } catch (e) { }
	}

	if (options.legacyShim !== false) {
		window.getFimainfoLegacyId = window.getFimainfoLegacyId || function (name) { return '#' + idp(cid, name); };
	}
}

/* ====== Events per instance - CONVERTI VANILLA JS ====== */
function initializeTableEventListenersForInstance(cid) {
	const state = getInstanceState(cid);
	const options = state.options || {};

	// Get elements
	const globalSearch = document.getElementById(idp(cid, 'global_search'));
	const prevBtn = document.getElementById(idp(cid, 'prev_page'));
	const nextBtn = document.getElementById(idp(cid, 'next_page'));
	const pageSize = document.getElementById(idp(cid, 'page_size_selector'));
	const columnsToggle = document.getElementById(idp(cid, 'columns_toggle'));
	const columnsDropdown = document.getElementById(idp(cid, 'columns_dropdown'));
	const btnFiche = document.getElementById(idp(cid, 'btn_fiche'));
	const exportCsv = document.getElementById(idp(cid, 'export_csv'));
	const exportXls = document.getElementById(idp(cid, 'export_xls'));
	const tableContainer = document.getElementById(idp(cid, 'table_container'));

	// Global search
	if (globalSearch) {
		globalSearch.addEventListener('input', () => applyGlobalSearchForInstance(cid));
	}

	// Pagination
	if (prevBtn) {
		prevBtn.addEventListener('click', () => {
			if (state.currentPage > 1) {
				state.currentPage--;
				renderTableForInstance(cid);
				updatePaginationForInstance(cid);
				updateResultsCountForInstance(cid);
			}
		});
	}

	if (nextBtn) {
		nextBtn.addEventListener('click', () => {
			const totalPages = Math.ceil(state.filteredData.length / state.itemsPerPage);
			if (state.currentPage < totalPages) {
				state.currentPage++;
				renderTableForInstance(cid);
				updatePaginationForInstance(cid);
				updateResultsCountForInstance(cid);
			}
		});
	}

	if (pageSize) {
		pageSize.addEventListener('change', function () {
			state.itemsPerPage = parseInt(this.value, 10);
			state.currentPage = 1;
			persistSettings(cid, state);
			renderTableForInstance(cid);
			updatePaginationForInstance(cid);
			updateResultsCountForInstance(cid);
		});
	}

	// Column toggle
	if (columnsToggle && columnsDropdown) {
		columnsToggle.addEventListener('click', (e) => {
			e.stopPropagation();
			columnsDropdown.classList.toggle('hidden');
		});

		document.addEventListener('click', (e) => {
			if (!e.target.closest(`#${idp(cid, 'columns_toggle')}, #${idp(cid, 'columns_dropdown')}`)) {
				columnsDropdown.classList.add('hidden');
			}
		});
	}

	// Action buttons
	if (btnFiche) {
		btnFiche.addEventListener('click', () => {
			btnFiche.disabled = true;
			if (window.GLOBAL && window.GLOBAL.contextCampaign === 'Entrant') {
				const searchValue = document.getElementById(idp(cid, 'search_value'));
				const searchField = document.getElementById(idp(cid, 'search_field_entrant'));
				window.GLOBAL.valueRechercheEntrant = searchValue ? searchValue.value : '';
				window.GLOBAL.typeRechercheEntrant = searchField ? searchField.value : '';
				if (typeof showPage === 'function') showPage('Index');
			} else {
				const api = getPublicInstanceApi(cid);
				if (typeof GetAgentLink === 'function') {
					GetAgentLink().SearchModeSelect(window.GLOBAL ? window.GLOBAL.indiceFiche : api.getSelectedIndice(), true, api.getLastTel());
				}
			}
		});
	}

	if (exportCsv) {
		exportCsv.addEventListener('click', () => {
			try {
				exportCSVForInstance(cid);
				if (typeof state.callbacks.onExport === 'function') state.callbacks.onExport('csv');
			} catch (e) { }
		});
	}

	if (exportXls) {
		exportXls.addEventListener('click', () => {
			try {
				exportExcelForInstance(cid);
				if (typeof state.callbacks.onExport === 'function') state.callbacks.onExport('excel');
			} catch (e) { }
		});
	}

	// Filters
	const filtersGrid = document.getElementById(idp(cid, 'filters_grid'));
	if (filtersGrid) {
		filtersGrid.addEventListener('input', (e) => {
			if (e.target.type === 'text') {
				applyFiltersForInstance(cid);
			}
		});
	}

	// Virtualization
	if (options.virtualize && tableContainer) {
		tableContainer.addEventListener('scroll', () => virtualOnScrollHandler(cid));
	}
}

/* ====== Column dropdown - CONVERTI VANILLA JS ====== */
function initializeColumnDropdownForInstance(cid) {
	const state = getInstanceState(cid);
	const checkboxContainer = document.getElementById(idp(cid, 'column_checkboxes'));
	if (!checkboxContainer) return;

	// Пересобираем список чекбоксов
	checkboxContainer.innerHTML = '';

	const sortedKeys = Object.keys(state.columnDefinitions).sort((a, b) => {
		const ai = a.includes('indice'), bi = b.includes('indice');
		if (ai && !bi) return -1;
		if (!ai && bi) return 1;
		return 0;
	});

	sortedKeys.forEach((k) => {
		const col = state.columnDefinitions[k];
		const checked = state.visibleColumns[k] !== false;

		const labelEl = document.createElement('label');
		labelEl.className = 'flex items-center px-4 py-2 hover:bg-gray-50 cursor-pointer';

		const input = document.createElement('input');
		input.type = 'checkbox';
		input.className = 'mr-3';
		input.dataset.column = k;
		input.checked = checked;

		const span = document.createElement('span');
		span.className = 'text-sm text-gray-700';
		span.textContent = col.label;

		labelEl.appendChild(input);
		labelEl.appendChild(span);
		checkboxContainer.appendChild(labelEl);
	});

	// Заголовок дропа (AFFICHER TOUTES LES COLONNES / Colonnes affichées)
	updateColumnDropdownTitleForInstance(cid);

	if (!checkboxContainer.__bound) {
		checkboxContainer.addEventListener('change', (e) => {
			const cb = e.target.closest('input[type="checkbox"][data-column]');
			if (!cb) return;

			const k = cb.dataset.column;
			state.visibleColumns[k] = cb.checked;

			persistSettings(cid, state);
			updateColumnDropdownTitleForInstance(cid);
			renderTableForInstance(cid);
		});
		checkboxContainer.__bound = true;
	}
}


function updateColumnDropdownTitleForInstance(cid) {
	const state = getInstanceState(cid);
	const titleEl = document.getElementById(idp(cid, 'column_dropdown_title'));
	if (!titleEl) return;

	const allChecked = Object.keys(state.columnDefinitions).every(k => state.visibleColumns[k] !== false);
	if (allChecked) {
		titleEl.textContent = 'Colonnes affichées';
	} else {
		titleEl.innerHTML = '<button class="w-full text-left">AFFICHER TOUTES LES COLONNES</button>';
		const btn = titleEl.querySelector('button');
		if (btn) {
			btn.addEventListener('click', (e) => {
				e.stopPropagation();
				Object.keys(state.columnDefinitions).forEach(k => state.visibleColumns[k] = true);
				const checkboxes = document.querySelectorAll(`#${idp(cid, 'column_checkboxes')} input[type="checkbox"]`);
				checkboxes.forEach(cb => cb.checked = true);
				persistSettings(cid, state);
				updateColumnDropdownTitleForInstance(cid);
				renderTableForInstance(cid);
			});
		}
	}
}

/* ====== Filters UI - CONVERTI VANILLA JS ====== */
function generateDynamicFiltersForInstance(cid) {
	const state = getInstanceState(cid);
	const grid = document.getElementById(idp(cid, 'filters_grid'));
	if (!grid) return;
	grid.innerHTML = '';

	const cnt = Object.keys(state.columnDefinitions).length;
	let gridCols = 'grid-cols-2 md:grid-cols-4 lg:grid-cols-8';
	if (cnt <= 4) gridCols = 'grid-cols-2 md:grid-cols-4';
	else if (cnt <= 6) gridCols = 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6';
	grid.className = 'grid gap-3 ' + gridCols;

	const sortedKeys = Object.keys(state.columnDefinitions).sort((a, b) => {
		const ai = a.includes('indice'), bi = b.includes('indice');
		if (ai && !bi) return -1;
		if (!ai && bi) return 1;
		return 0;
	});

	sortedKeys.forEach((k) => {
		const col = state.columnDefinitions[k];
		const fid = idp(cid, `filter_${k}`);
		const div = document.createElement('div');
		div.className = 'relative';
		div.innerHTML = `
      <input type="text" id="${fid}" placeholder="${escapeAttr(col.label)}" class="pl-8 pr-3 py-1.5 border border-gray-300 rounded-md text-sm w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
      <svg class="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
    `;
		grid.appendChild(div);
	});
}

/* ====== Init data - CONVERTI VANILLA JS ====== */
function initTableRechercheForInstance(data = [], options = {}) {
	const cid = options.containerId;
	if (!cid) { console.error('initTableRechercheForInstance: containerId required'); return; }
	const state = getInstanceState(cid);

	console.log('🔄 initTableRechercheForInstance:', cid, 'données:', data.length);

	let processed;
	if (data && data.length > 0) {
		processed = Array.isArray(data) ? data.slice(0, 20000) : [data];
		console.log('📊 Données traitées:', processed.length, 'enregistrements');

		initializeColumnsForInstance(cid, processed, options);
		console.log('✅ Colonnes initialisées');

		if (options.enableFilters !== false) {
			generateDynamicFiltersForInstance(cid);
			console.log('✅ Filtres générés');
		}

		if (options.enableColumnToggle !== false) initializeColumnDropdownForInstance(cid);
	} else {
		console.warn('❌ Pas de données, chargement des données d\'exemple');
		loadSampleDataForInstance(cid);
		return;
	}

	state.currentData = processed;
	state.filteredData = [...state.currentData];
	state.currentPage = 1;
	state.itemsPerPage = options.itemsPerPageCount || state.itemsPerPage;

	console.log('🎯 Avant renderTableForInstance, state:', {
		currentData: state.currentData.length,
		filteredData: state.filteredData.length,
		columnDefinitions: Object.keys(state.columnDefinitions).length,
		visibleColumns: Object.keys(state.visibleColumns).length
	});

	renderTableForInstance(cid);
	console.log('✅ Table rendue');

	updatePaginationForInstance(cid);
	updateResultsCountForInstance(cid);
	afficheTableauChargementForInstance(cid, false);

	const btnFiche = document.getElementById(idp(cid, 'btn_fiche'));
	if (btnFiche) btnFiche.disabled = true;

	if (typeof state.callbacks.onRenderComplete === 'function') {
		try { state.callbacks.onRenderComplete(getPublicInstanceApi(cid)); } catch (e) { }
	}
}

function initializeColumnsForInstance(cid, sqlData, options = {}) {
	const state = getInstanceState(cid);
	const { columns, visibility } = generateColumnDefinitions(sqlData, options);
	const persisted = loadPersistedSettings(cid);
	if (persisted && persisted.visibleColumns) {
		Object.keys(visibility).forEach(k => {
			if (k in persisted.visibleColumns) visibility[k] = persisted.visibleColumns[k];
		});
	}
	state.columnDefinitions = columns;
	state.visibleColumns = visibility;
	state.sortState = {};
}

/* ====== Render - CONVERTI VANILLA JS ====== */
function renderTableForInstance(cid) {
	console.log('🎨 renderTableForInstance démarré pour:', cid);

	const st = getInstanceState(cid);
	const options = st.options || {};
	const startIndex = (st.currentPage - 1) * st.itemsPerPage;
	const endIndex = startIndex + st.itemsPerPage;
	const pageData = st.filteredData.slice(startIndex, endIndex);

	console.log('📄 Données de page:', pageData.length, 'sur', st.filteredData.length, 'total');

	const thead = document.getElementById(idp(cid, 'table_head'));
	console.log('🔍 thead trouvé:', !!thead, 'ID:', idp(cid, 'table_head'));
	if (thead) thead.innerHTML = '';

	const keysSorted = Object.keys(st.columnDefinitions).sort((a, b) => {
		const ai = a.includes('indice'), bi = b.includes('indice');
		if (ai && !bi) return -1;
		if (!ai && bi) return 1;
		return 0;
	});

	console.log('📋 Colonnes triées:', keysSorted.length, keysSorted);
	console.log('👁️ Colonnes visibles:', Object.keys(st.visibleColumns).filter(k => st.visibleColumns[k]));

	const visibleCount = keysSorted.filter(k => st.visibleColumns[k]).length || 1;
	const widthPercent = (100 / visibleCount) + '%';

	let headerHtml = '<tr>';
	keysSorted.forEach((k) => {
		if (!st.visibleColumns[k]) return;
		const col = st.columnDefinitions[k];
		const sortDirection = st.sortState[k];
		let sortIcon = '';
		let cursorClass = '';

		if (options.orderByColumns) {
			cursorClass = 'cursor-pointer hover:bg-gray-100 transition-colors duration-150';
			if (sortDirection === 'asc') {
				// ASC
				sortIcon = '<svg class="w-4 h-4 ml-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path></svg>';
			} else if (sortDirection === 'desc') {
				// DESC
				sortIcon = '<svg class="w-4 h-4 ml-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';
			} else {
				// default
				sortIcon = '<svg class="w-4 h-4 ml-1 inline opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"></path></svg>';
			}
		}

		headerHtml += `
		     <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px] ${cursorClass}" style="width: ${widthPercent};" data-column="${k}">
		       <div class="flex items-center justify-between">
		         <span class="column-title">${escapeAttr(col.label)}</span>
		         ${sortIcon}
		       </div>
		     </th>
		   `;
	});
	headerHtml += '</tr>';

	console.log('📝 Header HTML généré:', headerHtml.length, 'caractères');
	if (thead) thead.innerHTML = headerHtml;

	const tbody = document.getElementById(idp(cid, 'table_body'));
	console.log('🔍 tbody trouvé:', !!tbody, 'ID:', idp(cid, 'table_body'));
	if (!tbody) return;
	tbody.innerHTML = '';

	pageData.forEach((row, index) => {
		const indiceKey = Object.keys(row).find((k) => k.toLowerCase().includes('indice')) || Object.keys(row)[0];
		const indiceValue = row[indiceKey];
		const isSelected = st.selectedIndice && st.selectedIndice == indiceValue;

		let rowHtml = `<tr class="cursor-pointer table-row border-b border-gray-100 ${isSelected ? 'bg-blue-50' : 'hover:bg-blue-50'}" data-index="${startIndex + index}" data-indice="${indiceValue}">`;

		keysSorted.forEach((k) => {
			if (!st.visibleColumns[k]) return;

			const col = st.columnDefinitions[k];
			let cellValue = row[col.key] || '';

			if (col.key.toLowerCase().includes('tel') && cellValue) {
				cellValue = cellValue.toString().replace(/\s/g, '');
			}

			// Форматирование дат
			if ((col.key.toLowerCase().includes('date') || col.key.toLowerCase().includes('appel')) && cellValue) {
				cellValue = formatDateValue(cellValue);
			}

			if (st.options && (st.options.badgeColumns || st.options.badgeCounts) &&
				(st.options.badgeColumns || st.options.badgeCounts || []).some(b => col.key.toLowerCase().includes(String(b).toLowerCase()) || String(b).toLowerCase().includes(col.key.toLowerCase()))) {
				rowHtml += `<td class="px-3 py-3 whitespace-nowrap">${getStatusBadge(cellValue)}</td>`;
			} else {
				const fw = col.key.toLowerCase().includes('indice') ? 'font-medium' : '';
				const strVal = String(cellValue);

				let isLong = false;
				let needsTruncate = false;

				if (strVal && strVal.length > 0) {
					isLong = strVal.length > 20;
					if (col.key.toLowerCase().includes('comment') || col.key.toLowerCase().includes('detail')) {
						needsTruncate = strVal.length > 15;
						isLong = strVal.length > 10;
					} else {
						needsTruncate = isLong;
					}
				}

				const trunc = needsTruncate ? 'truncate' : '';
				const tt = isLong && st.options && st.options.enableTooltip !== false ? ` data-tooltip="${escapeAttr(strVal)}"` : '';
				rowHtml += `<td class="px-3 py-3 whitespace-nowrap text-sm text-gray-900 ${fw} ${trunc}"${tt}>${escapeAttr(strVal)}</td>`;
			}
		});
		rowHtml += '</tr>';
		tbody.insertAdjacentHTML('beforeend', rowHtml);
	});

	// Row handlers with vanilla JS
	const container = document.getElementById(cid);
	if (container) {
		container.onclick = function (event) {
			const clickedRow = event.target.closest('.table-row');
			if (!clickedRow) return;

			const allRows = container.querySelectorAll('.table-row');
			allRows.forEach(row => {
				row.classList.remove('bg-blue-50');
				row.classList.add('hover:bg-gray-50');
			});

			clickedRow.classList.remove('hover:bg-gray-50');
			clickedRow.classList.add('bg-blue-50');

			const indice = clickedRow.dataset.indice;
			st.selectedIndice = indice;
			if (window.GLOBAL) window.GLOBAL.indiceFiche = indice;
			updateSelectedRowsForInstance(cid);

			try { st.callbacks.onRowSelect?.(getPublicInstanceApi(cid), indice); } catch { }
		};

		container.ondblclick = function (event) {
			const clickedRow = event.target.closest('.table-row');
			if (!clickedRow) return;
			const indice = clickedRow.dataset.indice;
			try { st.callbacks.onRowDblClick?.(getPublicInstanceApi(cid), indice); } catch { }
		};
	}


	if (options.enableColumnToggle !== false) initializeColumnDropdownForInstance(cid);

	if (options.orderByColumns !== false && thead) {
		thead.onclick = function (event) {
			const clickedTh = event.target.closest('th[data-column]');
			if (!clickedTh) return;

			const k = clickedTh.dataset.column;
			const col = st.columnDefinitions[k];
			if (!col) return;

			const current = st.sortState[k];
			const next = current === 'asc' ? 'desc' : current === 'desc' ? null : 'asc';

			Object.keys(st.sortState).forEach(x => st.sortState[x] = null);
			st.sortState[k] = next;

			if (next) {
				st.filteredData = sortData(st.filteredData, col.key, next);
				st.currentPage = 1;
				renderTableForInstance(cid);
				updatePaginationForInstance(cid);
				updateResultsCountForInstance(cid);
			} else {
				st.filteredData = [...st.currentData];
				applyFiltersForInstance(cid);
			}
		};
	}


	if (typeof st.callbacks.onRenderComplete === 'function') {
		try { st.callbacks.onRenderComplete(getPublicInstanceApi(cid)); } catch (e) { }
	}
}

/* ====== Row builder - IDENTIQUE ====== */
function buildRowHtmlForInstance(cid, row, absoluteIndex) {
	const st = getInstanceState(cid);
	const keysSorted = Object.keys(st.columnDefinitions).sort((a, b) => {
		const ai = a.includes('indice'), bi = b.includes('indice');
		if (ai && !bi) return -1;
		if (!ai && bi) return 1;
		return 0;
	});
	const indiceKey = Object.keys(row).find(k => k.toLowerCase().includes('indice')) || Object.keys(row)[0];
	const indiceValue = row[indiceKey];
	const isSelected = st.selectedIndice && st.selectedIndice == indiceValue;

	let html = `<tr class="cursor-pointer table-row border-b border-gray-100 ${isSelected ? 'bg-blue-50' : 'hover:bg-blue-50'}" data-index="${absoluteIndex}" data-indice="${escapeAttr(indiceValue)}">`;
	keysSorted.forEach((k) => {
		if (!st.visibleColumns[k]) return;
		const col = st.columnDefinitions[k];
		let val = row[col.key] ?? '';
		if (col.key.toLowerCase().includes('tel') && val) val = String(val).replace(/\s/g, '');
		if ((col.key.toLowerCase().includes('date') || col.key.toLowerCase().includes('appel')) && val) {
			val = formatDateValue(val);
		}
		if (st.options && (st.options.badgeColumns || st.options.badgeCounts) &&
			(st.options.badgeColumns || st.options.badgeCounts || []).some(b => col.key.toLowerCase().includes(String(b).toLowerCase()) || String(b).toLowerCase().includes(col.key.toLowerCase()))) {
			html += `<td class="px-3 py-3 whitespace-nowrap">${getStatusBadge(val)}</td>`;
		} else {
			const fw = col.key.toLowerCase().includes('indice') ? 'font-medium' : '';
			const strVal = String(val);

			let isLong = false;
			let needsTruncate = false;

			if (strVal && strVal.length > 0) {
				isLong = strVal.length > 20;
				if (col.key.toLowerCase().includes('comment') || col.key.toLowerCase().includes('detail')) {
					needsTruncate = strVal.length > 15;
					isLong = strVal.length > 10;
				} else {
					needsTruncate = isLong;
				}
			}

			const trunc = needsTruncate ? 'truncate' : '';
			const tt = isLong && st.options && st.options.enableTooltip !== false ? ` data-tooltip="${escapeAttr(strVal)}"` : '';
			html += `<td class="px-3 py-3 whitespace-nowrap text-sm text-gray-900 ${fw} ${trunc}"${tt}>${escapeAttr(strVal)}</td>`;
		}
	});
	html += '</tr>';
	return html;
}

/* ====== Filtering / search - CONVERTI VANILLA JS ====== */
function applyFiltersForInstance(cid) {
	const st = getInstanceState(cid);
	const filters = {};
	Object.keys(st.columnDefinitions).forEach(k => {
		const el = document.getElementById(idp(cid, `filter_${k}`));
		if (el) {
			const v = el.value;
			if (v) filters[k] = String(v).toLowerCase();
		}
	});

	st.filteredData = st.currentData.filter(row => {
		const fm = Object.keys(filters).every(k => {
			const col = st.columnDefinitions[k];
			const fv = filters[k];
			let rv = row[col.key];
			if (!rv) return false;

			// Применяем форматирование для поиска
			// Проверяем телефонные номера (как по названию колонки, так и по содержимому)
			if ((col.key.toLowerCase().includes('tel') || isPhoneNumber(rv)) && rv) {
				const normalizedValue = normalizePhoneForSearch(rv);
				const normalizedFilter = normalizePhoneForSearch(fv);
				return normalizedValue.toLowerCase().includes(normalizedFilter.toLowerCase());
			}
			if ((col.key.toLowerCase().includes('date') || col.key.toLowerCase().includes('appel')) && rv) {
				const formattedDate = formatDateValue(rv);
				// Ищем как в исходном значении, так и в отформатированном
				return String(rv).toLowerCase().includes(fv) || formattedDate.toLowerCase().includes(fv);
			}
			return String(rv).toLowerCase().includes(fv);
		});

		const gsEl = document.getElementById(idp(cid, 'global_search'));
		const gsv = gsEl ? String(gsEl.value).toLowerCase() : '';
		if (gsv) {
			const gm = Object.keys(st.columnDefinitions).some(k => {
				if (!st.visibleColumns[k]) return false;
				const col = st.columnDefinitions[k];
				let rv = row[col.key];
				if (!rv) return false;

				// Применяем форматирование для глобального поиска
				// Проверяем телефонные номера (как по названию колонки, так и по содержимому)
				if ((col.key.toLowerCase().includes('tel') || isPhoneNumber(rv)) && rv) {
					const normalizedValue = normalizePhoneForSearch(rv);
					const normalizedSearch = normalizePhoneForSearch(gsv);
					return normalizedValue.toLowerCase().includes(normalizedSearch.toLowerCase());
				}
				if ((col.key.toLowerCase().includes('date') || col.key.toLowerCase().includes('appel')) && rv) {
					const formattedDate = formatDateValue(rv);
					// Ищем как в исходном значении, так и в отформатированном
					return String(rv).toLowerCase().includes(gsv) || formattedDate.toLowerCase().includes(gsv);
				}
				return String(rv).toLowerCase().includes(gsv);
			});
			return fm && gm;
		}
		return fm;
	});

	st.currentPage = 1;
	const active = Object.keys(st.sortState).find(k => st.sortState[k]);
	if (active) {
		const col = st.columnDefinitions[active];
		if (col) st.filteredData = sortData(st.filteredData, col.key, st.sortState[active]);
	}
	renderTableForInstance(cid);
	updatePaginationForInstance(cid);
	updateResultsCountForInstance(cid);
}

function applyGlobalSearchForInstance(cid) {
	applyFiltersForInstance(cid);
}

/* ====== Pagination & counts - CONVERTI VANILLA JS ====== */
function updatePaginationForInstance(cid) {
	const st = getInstanceState(cid);
	const totalPages = Math.max(1, Math.ceil(st.filteredData.length / st.itemsPerPage));

	const currentPageEl = document.getElementById(idp(cid, 'current_page'));
	const totalPagesEl = document.getElementById(idp(cid, 'total_pages'));
	const prevBtn = document.getElementById(idp(cid, 'prev_page'));
	const nextBtn = document.getElementById(idp(cid, 'next_page'));

	if (currentPageEl) currentPageEl.textContent = st.currentPage;
	if (totalPagesEl) totalPagesEl.textContent = totalPages;
	if (prevBtn) prevBtn.disabled = st.currentPage === 1;
	if (nextBtn) nextBtn.disabled = st.currentPage === totalPages;

	const nums = document.getElementById(idp(cid, 'page_numbers'));
	if (nums) nums.innerHTML = '';

	const addBtn = (p, active = false, dots = false) => {
		if (!nums) return;
		if (dots) {
			const span = document.createElement('span');
			span.className = 'px-2 text-xs text-gray-400';
			span.textContent = '...';
			nums.appendChild(span);
		} else if (active) {
			const btn = document.createElement('button');
			btn.className = `px-2 py-1 text-xs text-white ${getCurrentPalette(st.options).buttonBg} rounded`;
			btn.textContent = p;
			nums.appendChild(btn);
		} else {
			const btn = document.createElement('button');
			btn.className = 'px-2 py-1 text-xs page-btn border border-gray-300 rounded hover:bg-gray-50';
			btn.dataset.page = p;
			btn.textContent = p;
			btn.addEventListener('click', function () {
				st.currentPage = parseInt(this.dataset.page, 10);
				renderTableForInstance(cid);
				updatePaginationForInstance(cid);
				updateResultsCountForInstance(cid);
			});
			nums.appendChild(btn);
		}
	};

	if (totalPages >= 1) addBtn(1, st.currentPage === 1);
	const d = 1;
	const rs = Math.max(2, st.currentPage - d);
	const re = Math.min(totalPages - 1, st.currentPage + d);
	if (rs > 2) addBtn(null, false, true);
	for (let i = rs; i <= re; i++) {
		if (i !== 1 && i !== totalPages) addBtn(i, i === st.currentPage);
	}
	if (re < totalPages - 1) addBtn(null, false, true);
	if (totalPages > 1) addBtn(totalPages, st.currentPage === totalPages);
}

function updateResultsCountForInstance(cid) {
	const st = getInstanceState(cid);
	const total = st.currentData.length;
	const filtered = st.filteredData.length;
	const start = filtered === 0 ? 0 : (st.currentPage - 1) * st.itemsPerPage + 1;
	const end = filtered === 0 ? 0 : Math.min(start + st.itemsPerPage - 1, filtered);

	const countEl = document.getElementById(idp(cid, 'results_count'));
	const summaryEl = document.getElementById(idp(cid, 'results_summary'));

	if (countEl) countEl.textContent = `${filtered} résultats sur ${total}`;
	if (summaryEl) summaryEl.textContent = filtered > 0 ? `Affichage de ${start} à ${end} sur ${filtered} résultats` : 'Aucun résultat';
}

/* ====== Selection helpers - CONVERTI VANILLA JS ====== */
function updateSelectedRowsForInstance(cid) {
	const st = getInstanceState(cid);
	const has = st.selectedIndice != null;

	const btnFiche = document.getElementById(idp(cid, 'btn_fiche'));
	if (btnFiche) btnFiche.disabled = !has;

	if (has) {
		const idxKey = Object.keys(st.currentData[0] || {}).find(k => k.toLowerCase().includes('indice')) || Object.keys(st.currentData[0] || {})[0];
		const selected = (st.currentData || []).find(r => r[idxKey] == st.selectedIndice);
		if (selected) {
			const telKey = Object.keys(selected).find(k => k.toLowerCase().includes('tel') && selected[k]);
			if (telKey) st.lastTel = selected[telKey];
			if (window.GLOBAL) window.GLOBAL.indiceFiche = st.selectedIndice;
		}
	}
}

/* ====== Virtual scroll ====== */
function virtualOnScrollHandler(cid) {
	renderTableForInstance(cid);
}

/* ====== Sort helper - FIXED VERSION ====== */
function sortData(data, columnKey, direction) {
	if (!direction) return data;

	return [...data].sort((a, b) => {
		let aVal = a[columnKey];
		let bVal = b[columnKey];

		// Gérer les valeurs nulles ou undefined
		if (aVal == null) aVal = '';
		if (bVal == null) bVal = '';

		// Pour les colonnes numériques (comme Indice), trier numériquement
		if (columnKey.toLowerCase().includes('indice') || columnKey.toLowerCase().includes('priorite')) {
			aVal = parseFloat(aVal) || 0;
			bVal = parseFloat(bVal) || 0;
			if (direction === 'asc') {
				return aVal - bVal;
			} else {
				return bVal - aVal;
			}
		}

		// Pour les dates, trier chronologiquement
		if (columnKey.toLowerCase().includes('date') || columnKey.toLowerCase().includes('appel')) {
			const aDate = moment(aVal);
			const bDate = moment(bVal);
			if (aDate.isValid() && bDate.isValid()) {
				if (direction === 'asc') {
					return aDate - bDate;
				} else {
					return bDate - aDate;
				}
			}
		}

		// Sinon, trier comme des chaînes de caractères
		aVal = String(aVal).toLowerCase();
		bVal = String(bVal).toLowerCase();

		if (direction === 'asc') {
			return aVal.localeCompare(bVal);
		} else {
			return bVal.localeCompare(aVal);
		}
	});
}

/* ====== Badges - IDENTIQUE ====== */
function getStatusBadge(status) {
	if (!status) return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-800">${status || 'N/A'}</span>`;
	const s = String(status).toLowerCase();
	if (s.includes('rappel')) return `<span class="px-2 py-0.5 rounded-lg text-xs font-medium bg-yellow-100 text-yellow-800">${escapeAttr(status)}</span>`;
	if (s.includes('rdv')) return `<span class="px-2 py-0.5 rounded-lg text-xs font-medium bg-blue-100 text-blue-800">${escapeAttr(status)}</span>`;
	if (s.includes('relance')) return `<span class="px-2 py-0.5 rounded-lg text-xs font-medium bg-purple-100 text-purple-800">${escapeAttr(status)}</span>`;
	if (s.includes('absent') || s.includes('non répondu')) return `<span class="px-2 py-0.5 rounded-lg text-xs font-medium bg-red-100 text-red-800">${escapeAttr(status)}</span>`;
	if (s.includes('refus') || s.includes('négatif')) return `<span class="px-2 py-0.5 rounded-lg text-xs font-medium bg-orange-100 text-orange-800">${escapeAttr(status)}</span>`;
	if (s.includes('positif') || s.includes('accepté') || s.includes('validé')) return `<span class="px-2 py-0.5 rounded-lg text-xs font-medium bg-green-100 text-green-800">${escapeAttr(status)}</span>`;
	if (s.includes('en cours') || s.includes('traitement')) return `<span class="px-2 py-0.5 rounded-lg text-xs font-medium bg-cyan-100 text-cyan-800">${escapeAttr(status)}</span>`;
	if (s.includes('urgent') || s.includes('priorité')) return `<span class="px-2 py-0.5 rounded-lg text-xs font-medium bg-pink-100 text-pink-800">${escapeAttr(status)}</span>`;
	return `<span class="px-2 py-0.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-800">${escapeAttr(status)}</span>`;
}

/* ====== Sample data (dev) - IDENTIQUE ====== */
function loadSampleDataForInstance(cid) {
	const st = getInstanceState(cid);
	st.currentPage = 1;
	const size = Math.max(50, st.itemsPerPage * 10);
	const base = { "Agent": "", "Commentaire": "", "Date appel": "", "Dpt": "", "Détail": "", "Indice": "", "Nom prospect": "", "Nom société": "", "PRIORITE": "", "Relance": "", "SIREN": "", "Statut": "", "Tel fixe": "", "Tel port": "", "contact_ville": "", "montant": "" };
	const agents = ["Rachida MESSAOUDI", "Marie DUPONT", "Pierre BERNARD", "Sophie THOMAS", "Luc PETIT", "Anne ROBERT", "Paul RICHARD", "Julie MOREAU"];
	const statuts = ["Refus argumenté", "Rdv", "Rappel", "Relance", "Test", "Absent"];
	const villes = ["dijon", "paris", "lyon", "marseille", "toulouse", "nice", "nantes", "strasbourg"];
	const soc = ["", "SARL MARTIN", "EURL BERNARD", "SAS ROBERT", "SASU DUPONT", "SA THOMAS"];
	const arr = [];
	for (let i = 0; i < size; i++) {
		const d = { ...base };
		d.Indice = 217570 + i;
		d.Agent = agents[i % agents.length];
		d.Statut = statuts[i % statuts.length];
		d.contact_ville = villes[i % villes.length];
		d["Nom société"] = soc[i % soc.length];
		d["Date appel"] = `2024-06-${String(25 + (i % 5)).padStart(2, '0')} ${String(9 + (i % 12)).padStart(2, '0')}:${String(15 + (i % 45)).padStart(2, '0')}`;
		d.PRIORITE = (i % 5) - 1;
		d.Commentaire = i % 3 === 0 ? "Client intéressé ".repeat(22).trim() : i % 3 === 1 ? "À rappeler" : "";
		d["Tel port"] = i % 2 === 0 ? `06 ${String(10 + (i % 89)).padStart(2, '0')} ${String(10 + (i % 89)).padStart(2, '0')}` : "";
		d.montant = i % 4 === 0 ? String((i + 1) * 1000) : "";
		arr.push(d);
	}
	initializeColumnsForInstance(cid, arr, st.options || {});
	if (st.options && st.options.enableFilters !== false) generateDynamicFiltersForInstance(cid);
	if (st.options && st.options.enableColumnToggle !== false) initializeColumnDropdownForInstance(cid);
	st.currentData = arr;
	st.filteredData = [...st.currentData];
	renderTableForInstance(cid);
	updatePaginationForInstance(cid);
	updateResultsCountForInstance(cid);
	afficheTableauChargementForInstance(cid, false);

	const btnFiche = document.getElementById(idp(cid, 'btn_fiche'));
	if (btnFiche) btnFiche.disabled = true;
}

/* ====== JSON loader - CONVERTI VANILLA JS ====== */
function loadDataFromJSONForInstance(cid, json) {
	if (!Array.isArray(json)) { console.error('loadDataFromJSONForInstance expects array'); return; }
	const st = getInstanceState(cid);
	st.currentData = json;
	st.filteredData = [...st.currentData];
	st.currentPage = 1;
	initializeColumnsForInstance(cid, st.currentData, st.options || {});
	if (st.options && st.options.enableFilters !== false) generateDynamicFiltersForInstance(cid);
	if (st.options && st.options.enableColumnToggle !== false) initializeColumnDropdownForInstance(cid);
	renderTableForInstance(cid);
	updatePaginationForInstance(cid);
	updateResultsCountForInstance(cid);
	afficheTableauChargementForInstance(cid, false);

	const btnFiche = document.getElementById(idp(cid, 'btn_fiche'));
	if (btnFiche) btnFiche.disabled = true;
}

/* ====== Loading indicator - CONVERTI VANILLA JS ====== */
function afficheTableauChargementForInstance(cid, show) {
	const tableContainer = document.getElementById(idp(cid, 'table_container'));
	const loadingSpinner = document.getElementById(idp(cid, 'loading-spinner'));

	if (show) {
		if (tableContainer) tableContainer.style.display = 'none';
		if (loadingSpinner) loadingSpinner.classList.remove('hidden');
	} else {
		if (tableContainer) tableContainer.style.display = '';
		if (loadingSpinner) loadingSpinner.classList.add('hidden');
	}
}

/* ====== Export - IDENTIQUE ====== */
function exportCSVForInstance(cid) {
	const st = getInstanceState(cid);
	const cols = Object.keys(st.columnDefinitions).filter(k => st.visibleColumns[k]);
	if (cols.length === 0) { alert('Aucune colonne visible à exporter'); return; }
	const header = cols.map(k => `"${st.columnDefinitions[k].label.replace(/"/g, '""')}"`).join(',');
	const rows = st.filteredData.map(row => cols.map(k => {
		const v = row[st.columnDefinitions[k].key];
		return `"${(v == null ? '' : String(v)).replace(/"/g, '""')}"`;
	}).join(','));
	const csv = [header].concat(rows).join('\r\n');
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${cid}_export.csv`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

function exportExcelForInstance(cid) {
	const st = getInstanceState(cid);
	const cols = Object.keys(st.columnDefinitions).filter(k => st.visibleColumns[k]);
	if (cols.length === 0) { alert('Aucune colonne visible à exporter'); return; }
	const header = cols.map(k => st.columnDefinitions[k].label).join('\t');
	const rows = st.filteredData.map(row => cols.map(k => row[st.columnDefinitions[k].key] ?? '').join('\t'));
	const tsv = [header].concat(rows).join('\r\n');
	const blob = new Blob([tsv], { type: 'application/vnd.ms-excel;charset=utf-8;' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${cid}_export.xls`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

/* ====== Public API per instance - IDENTIQUE ====== */
function getPublicInstanceApi(cid) {
	return {
		updateData: (newData) => {
			initTableRechercheForInstance(Array.isArray(newData) ? newData : [newData], {
				...(getInstanceState(cid).options || {}),
				containerId: cid
			});
		},
		loadJSON: (json) => { loadDataFromJSONForInstance(cid, json); },
		selectIndice: (indice) => {
			const st = getInstanceState(cid);
			st.selectedIndice = indice;
			if (window.GLOBAL) window.GLOBAL.indiceFiche = indice;
			updateSelectedRowsForInstance(cid);
		},
		getSelectedIndice: () => getInstanceState(cid).selectedIndice,
		getLastTel: () => getInstanceState(cid).lastTel,
		getState: () => getInstanceState(cid),
		exportCSV: () => exportCSVForInstance(cid),
		exportExcel: () => exportExcelForInstance(cid),
		on: function (eventName, fn) {
			const st = getInstanceState(cid);
			st.callbacks[eventName] = fn;
			return this;
		}
	};
}

/* ====== createTable (entry) - COMPLETE ====== */
function createTable(options = {}) {
	if (!options.containerId) { console.error('createTable: options.containerId is required'); return; }
	const cid = options.containerId;
	const st = getInstanceState(cid);

	// Default options with ALL supported options
	options.theme = options.theme || 'default';
	options.badgeColumns = options.badgeColumns || (options.badgeCounts ? options.badgeCounts : ['Statut']);
	options.orderByColumns = options.orderByColumns !== false;
	options.enablePageSizeSelector = options.enablePageSizeSelector !== false;
	options.enableSearch = options.enableSearch !== false;
	options.enableFilters = options.enableFilters !== false;
	options.enableColumnToggle = options.enableColumnToggle !== false;
	options.enableTooltip = options.enableTooltip !== false;
	options.enableActionButton = options.enableActionButton !== false;
	options.virtualizeThreshold = options.virtualizeThreshold || 1000;
	options.legacyShim = options.hasOwnProperty('legacyShim') ? options.legacyShim : true;

	st.options = options;
	st.currentPage = 1;
	st.itemsPerPage = options.itemsPerPageCount || st.itemsPerPage;

	if (options.colorPalette && Array.isArray(options.colorPalette) && options.colorPalette.length === 2) {
		options.customPalette = {
			headerBg: options.colorPalette[0],
			buttonBg: options.colorPalette[1],
			buttonHover: generateHoverClass(options.colorPalette[1])
		};
	}

	afficheRechercheTableau(options);
	initTableRechercheForInstance(Array.isArray(options.data) ? options.data : (options.data ? [options.data] : []), options);

	const api = getPublicInstanceApi(cid);
	window.createTableInstances = window.createTableInstances || {};
	window.createTableInstances[cid] = api;
	return api;
}

// Expose globally
window.createTable = createTable;
window.libTableFimainfo = window.libTableFimainfo || {};
window.libTableFimainfo.getInstanceState = getInstanceState;
window.libTableFimainfo.createTable = createTable;

console.log('✅ lib_table_fimainfo_smiro_vanilla.js COMPLET chargé avec succès');

/* ====== END OF FILE ====== */
