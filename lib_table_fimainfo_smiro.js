/**
 * lib_table_fimainfo_smiro.js
 * Полная инстанс-ориентированная версия таблицы
 * Поддерживает:
 *  - все опции/функции из старого файла (поиск, фильтры, tri, pagination, badges, formatting)
 *  - per-instance state (несколько таблиц на странице)
 *  - callbacks: onRowSelect, onRowDblClick, onReady, onRenderComplete, onExport
 *  - exportCSV, exportExcel
 *  - localStorage persistence (visible columns & itemsPerPage)
 *  - optional virtualization (options.virtualize)
 *  - Floating UI / tippy.js integration (если доступны)
 *  - legacy compatibility: сохраняется GLOBAL.indiceFiche; опция legacyShim (по умолчанию true) создаёт helper window.getFimainfoLegacyId(name)
 *
 * Требования: moment.js должен быть подключён.
 */

/* ====== CORE (per-instance state) ====== */
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

/* ====== Themes & utils ====== */
const colorThemes = {
	default: { headerBg: 'bg-gray-50', buttonBg: 'bg-blue-600', buttonHover: 'hover:bg-blue-700', badgeBase: 'bg-blue-100 text-blue-800' },
	dark: { headerBg: 'bg-slate-800', buttonBg: 'bg-slate-600', buttonHover: 'hover:bg-slate-700', badgeBase: 'bg-slate-100 text-slate-800' },
	light: { headerBg: 'bg-sky-50', buttonBg: 'bg-sky-600', buttonHover: 'hover:bg-sky-700', badgeBase: 'bg-sky-100 text-sky-800' }
};
function escapeAttr(s) { if (s == null) return ''; return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function generateHoverClass(bg) { const m = (bg || '').match(/bg-(\w+)-(\d+)/); if (m) { const c = m[1], sh = +m[2]; return `hover:bg-${c}-${Math.min(900, sh + 100)}`; } return 'hover:bg-gray-700'; }
function getCurrentPalette(options) { if (options && options.customPalette) return options.customPalette; return colorThemes[(options && options.theme) || 'default'] || colorThemes.default; }

/* ====== Column detection with 'as' support ====== */
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

/* ====== Persistence ====== */
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

/* ====== Floating UI tooltip (exact user design) ====== */
/* — сохраняю полностью как просил — */
function initializeFloatingUITooltips() {
	if (!window.FloatingUIDOM) return; // FUI не подключён

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

	// Supprime les anciens tooltips s'ils existent
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

		// Ajustements si le tooltip sort de l'écran
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

// гарантия одноразовой инициализации
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

/* ====== Shell render per-instance ====== */
function afficheRechercheTableau(options = {}) {
	if (!options.containerId) { console.error('afficheRechercheTableau: containerId required'); return; }
	const cid = options.containerId;
	const state = getInstanceState(cid);
	state.options = options;
	state.itemsPerPage = options.itemsPerPageCount || state.itemsPerPage;

	const container = $('#' + cid);
	if (container.length === 0) { console.error(`Container #${cid} not found`); return; }
	container.empty();

	const persisted = loadPersistedSettings(cid);
	if (persisted) { if (persisted.visibleColumns) state.visibleColumns = persisted.visibleColumns; if (persisted.itemsPerPage) state.itemsPerPage = persisted.itemsPerPage; }

	const palette = getCurrentPalette(options);
	const minWidth = (options.includedColumns && options.includedColumns.length ? options.includedColumns.length : 8) * 140;

	container.append(`
    <div class="bg-white rounded-lg shadow-sm border border-gray-200 w-full mx-auto">
      <!-- Header -->
      <div class="px-4 py-4 border-b border-gray-200 ${palette.headerBg}">
        <div class="flex items-center justify-between">
          ${options.enableSearch ? `
            <div class="flex-1 max-w-md mr-4">
              <div class="relative">
                <input type="text" id="${idp(cid, 'global_search')}" placeholder="Rechercher dans tous les champs affichés ..." class="pl-8 pr-3 py-1.5 border border-gray-300 rounded-md text-sm w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
                <svg class="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              </div>
            </div>` : ''}
          ${options.enableColumnToggle !== false ? `
            <div class="relative">
              <button id="${idp(cid, 'columns_toggle')}" class="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                Colonnes
                <svg class="w-4 h-4 ml-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
              </button>
              <div id="${idp(cid, 'columns_dropdown')}" class="hidden absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg border border-gray-200 z-50">
                <div class="py-2">
                  <div id="${idp(cid, 'column_dropdown_title')}" class="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100">Colonnes affichées</div>
                  <div id="${idp(cid, 'column_checkboxes')}" class="py-1"></div>
                </div>
              </div>
            </div>` : ''}
        </div>
      </div>

      <!-- Filters -->
      <div id="${idp(cid, 'filters_container')}" class="px-4 py-4 bg-gray-50 border-b border-gray-200">
        <div id="${idp(cid, 'filters_grid')}" class="grid gap-3"></div>
      </div>

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
        <button id="${idp(cid, 'export_csv')}" class="ml-3 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">Export CSV</button>
        <button id="${idp(cid, 'export_xls')}" class="ml-2 px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50">Export Excel</button>
      </div>` : ''}
    </div>
  `);

	initializeTableEventListenersForInstance(cid);

	// Floating UI — инициализируем один раз глобально
	ensureFloatingUITooltipsOnce();

	// onReady callback
	if (typeof state.callbacks.onReady === 'function') {
		try { state.callbacks.onReady(getPublicInstanceApi(cid)); } catch (e) { }
	}

	// legacy shim
	if (options.legacyShim !== false) {
		window.getFimainfoLegacyId = window.getFimainfoLegacyId || function (name) { return '#' + idp(cid, name); };
	}
}

/* ====== Events per instance ====== */
function initializeTableEventListenersForInstance(cid) {
	const state = getInstanceState(cid);
	const options = state.options || {};
	const $globalSearch = $('#' + idp(cid, 'global_search'));
	const $prev = $('#' + idp(cid, 'prev_page'));
	const $next = $('#' + idp(cid, 'next_page'));
	const $pageSize = $('#' + idp(cid, 'page_size_selector'));
	const $columnsToggle = $('#' + idp(cid, 'columns_toggle'));
	const $columnsDropdown = $('#' + idp(cid, 'columns_dropdown'));
	const $btnFiche = $('#' + idp(cid, 'btn_fiche'));
	const $exportCsv = $('#' + idp(cid, 'export_csv'));
	const $exportXls = $('#' + idp(cid, 'export_xls'));
	const $tableContainer = $('#' + idp(cid, 'table_container'));

	$globalSearch.off('input').on('input', () => applyGlobalSearchForInstance(cid));

	$prev.off('click').on('click', () => {
		if (state.currentPage > 1) { state.currentPage--; renderTableForInstance(cid); updatePaginationForInstance(cid); updateResultsCountForInstance(cid); }
	});
	$next.off('click').on('click', () => {
		const totalPages = Math.ceil(state.filteredData.length / state.itemsPerPage);
		if (state.currentPage < totalPages) { state.currentPage++; renderTableForInstance(cid); updatePaginationForInstance(cid); updateResultsCountForInstance(cid); }
	});
	$pageSize.off('change').on('change', function () {
		state.itemsPerPage = parseInt($(this).val(), 10); state.currentPage = 1; persistSettings(cid, state);
		renderTableForInstance(cid); updatePaginationForInstance(cid); updateResultsCountForInstance(cid);
	});

	if ($columnsToggle.length) {
		$columnsToggle.off('click').on('click', (e) => { e.stopPropagation(); $columnsDropdown.toggleClass('hidden'); });
		$(document).off('click.' + cid).on('click.' + cid, (e) => {
			if (!$(e.target).closest('#' + idp(cid, 'columns_toggle') + ', #' + idp(cid, 'columns_dropdown')).length) $('#' + idp(cid, 'columns_dropdown')).addClass('hidden');
		});
	}

	if ($btnFiche.length) {
		$btnFiche.off('click').on('click', () => {
			$btnFiche.prop('disabled', true);
			if (window.GLOBAL && window.GLOBAL.contextCampaign === 'Entrant') {
				window.GLOBAL.valueRechercheEntrant = $('#' + idp(cid, 'search_value')).val();
				window.GLOBAL.typeRechercheEntrant = $('#' + idp(cid, 'search_field_entrant')).val();
				if (typeof showPage === 'function') showPage('Index');
			} else {
				const api = getPublicInstanceApi(cid);
				if (typeof GetAgentLink === 'function') {
					GetAgentLink().SearchModeSelect(window.GLOBAL ? window.GLOBAL.indiceFiche : api.getSelectedIndice(), true, api.getLastTel());
				}
			}
		});
	}

	if ($exportCsv.length) { $exportCsv.off('click').on('click', () => { try { exportCSVForInstance(cid); if (typeof state.callbacks.onExport === 'function') state.callbacks.onExport('csv'); } catch (e) { } }); }
	if ($exportXls.length) { $exportXls.off('click').on('click', () => { try { exportExcelForInstance(cid); if (typeof state.callbacks.onExport === 'function') state.callbacks.onExport('excel'); } catch (e) { } }); }

	// filters
	$('#' + idp(cid, 'filters_grid')).off('input', 'input[type="text"]').on('input', 'input[type="text"]', () => applyFiltersForInstance(cid));

	// virtualization
	if (options.virtualize) {
		$tableContainer.off('scroll.virtual.' + cid).on('scroll.virtual.' + cid, () => virtualOnScrollHandler(cid));
	}
}

/* ====== Column dropdown ====== */
function initializeColumnDropdownForInstance(cid) {
	const state = getInstanceState(cid);
	const checkboxContainer = $('#' + idp(cid, 'column_checkboxes'));
	if (checkboxContainer.length === 0) return;
	checkboxContainer.empty();

	const sortedKeys = Object.keys(state.columnDefinitions).sort((a, b) => {
		const ai = a.includes('indice'), bi = b.includes('indice'); if (ai && !bi) return -1; if (!ai && bi) return 1; return 0;
	});

	sortedKeys.forEach((k) => {
		const col = state.columnDefinitions[k];
		const checked = state.visibleColumns[k] !== false ? 'checked' : '';
		checkboxContainer.append(`<label class="flex items-center px-4 py-2 hover:bg-gray-50 cursor-pointer"><input type="checkbox" ${checked} class="mr-3" data-column="${k}"><span class="text-sm text-gray-700">${col.label}</span></label>`);
	});

	updateColumnDropdownTitleForInstance(cid);

	checkboxContainer.off('change', 'input[type="checkbox"]').on('change', 'input[type="checkbox"]', function () {
		const k = $(this).data('column'); state.visibleColumns[k] = $(this).is(':checked'); persistSettings(cid, state);
		updateColumnDropdownTitleForInstance(cid); renderTableForInstance(cid);
	});
}
function updateColumnDropdownTitleForInstance(cid) {
	const state = getInstanceState(cid);
	const $title = $('#' + idp(cid, 'column_dropdown_title')); if (!$title.length) return;
	const allChecked = Object.keys(state.columnDefinitions).every(k => state.visibleColumns[k] !== false);
	if (allChecked) { $title.text('Colonnes affichées'); }
	else {
		$title.html('<button class="w-full text-left">AFFICHER TOUTES LES COLONNES</button>').off('click').on('click', (e) => {
			e.stopPropagation(); Object.keys(state.columnDefinitions).forEach(k => state.visibleColumns[k] = true);
			$('#' + idp(cid, 'column_checkboxes') + ' input[type="checkbox"]').prop('checked', true); persistSettings(cid, state);
			updateColumnDropdownTitleForInstance(cid); renderTableForInstance(cid);
		});
	}
}

/* ====== Filters UI ====== */
function generateDynamicFiltersForInstance(cid) {
	const state = getInstanceState(cid);
	const $grid = $('#' + idp(cid, 'filters_grid')); if (!$grid.length) return;
	$grid.empty();

	const cnt = Object.keys(state.columnDefinitions).length;
	let gridCols = 'grid-cols-2 md:grid-cols-4 lg:grid-cols-8'; if (cnt <= 4) gridCols = 'grid-cols-2 md:grid-cols-4'; else if (cnt <= 6) gridCols = 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6';
	$grid.removeClass().addClass('grid gap-3 ' + gridCols);

	const sortedKeys = Object.keys(state.columnDefinitions).sort((a, b) => {
		const ai = a.includes('indice'), bi = b.includes('indice'); if (ai && !bi) return -1; if (!ai && bi) return 1; return 0;
	});

	sortedKeys.forEach((k) => {
		const col = state.columnDefinitions[k];
		const fid = idp(cid, `filter_${k}`);
		$grid.append(`
      <div class="relative">
        <input type="text" id="${fid}" placeholder="${escapeAttr(col.label)}" class="pl-8 pr-3 py-1.5 border border-gray-300 rounded text-sm w-full focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500">
        <svg class="absolute left-2.5 top-2.5 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
      </div>
    `);
	});
}

/* ====== Init data ====== */
function initTableRechercheForInstance(data = [], options = {}) {
	const cid = options.containerId; if (!cid) { console.error('initTableRechercheForInstance: containerId required'); return; }
	const state = getInstanceState(cid);

	let processed;
	if (data && data.length > 0) { processed = Array.isArray(data) ? data.slice(0, 20000) : [data]; initializeColumnsForInstance(cid, processed, options); generateDynamicFiltersForInstance(cid); if (options.enableColumnToggle !== false) initializeColumnDropdownForInstance(cid); }
	else { loadSampleDataForInstance(cid); return; }

	state.currentData = processed; state.filteredData = [...state.currentData]; state.currentPage = 1; state.itemsPerPage = options.itemsPerPageCount || state.itemsPerPage;

	renderTableForInstance(cid); updatePaginationForInstance(cid); updateResultsCountForInstance(cid);
	afficheTableauChargementForInstance(cid, false);

	$('#' + idp(cid, 'btn_fiche')).prop('disabled', true);
	if (typeof state.callbacks.onRenderComplete === 'function') { try { state.callbacks.onRenderComplete(getPublicInstanceApi(cid)); } catch (e) { } }
}
function initializeColumnsForInstance(cid, sqlData, options = {}) {
	const state = getInstanceState(cid);
	const { columns, visibility } = generateColumnDefinitions(sqlData, options);
	const persisted = loadPersistedSettings(cid);
	if (persisted && persisted.visibleColumns) { Object.keys(visibility).forEach(k => { if (k in persisted.visibleColumns) visibility[k] = persisted.visibleColumns[k]; }); }
	state.columnDefinitions = columns; state.visibleColumns = visibility; state.sortState = {};
}

/* ====== Render (with width:100% + equal th widths, virtualization option) ====== */
function renderTableForInstance(cid) {
	const st = getInstanceState(cid);
	const options = st.options || {};
	const startIndex = (st.currentPage - 1) * st.itemsPerPage;
	const endIndex = startIndex + st.itemsPerPage;
	const pageData = st.filteredData.slice(startIndex, endIndex);

	const $thead = $('#' + idp(cid, 'table_head')); if ($thead.length) $thead.empty();

	const keysSorted = Object.keys(st.columnDefinitions).sort((a, b) => { const ai = a.includes('indice'), bi = b.includes('indice'); if (ai && !bi) return -1; if (!ai && bi) return 1; return 0; });
	const visibleCount = keysSorted.filter(k => st.visibleColumns[k]).length || 1;
	const widthPercent = (100 / visibleCount) + '%';

	let headerHtml = '<tr>';
	keysSorted.forEach((k) => {
		if (!st.visibleColumns[k]) return;
		const col = st.columnDefinitions[k];
		const sortDir = st.sortState[k];
		let sortIcon = '';
		if (options.orderByColumns) {
			if (sortDir === 'asc') sortIcon = '<svg class="w-4 h-4 ml-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>';
			else if (sortDir === 'desc') sortIcon = '<svg class="w-4 h-4 ml-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>';
			else sortIcon = '<svg class="w-4 h-4 ml-1 inline opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/></svg>';
		}
		headerHtml += `<th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100" style="width:${widthPercent}" data-column="${k}"><div class="flex items-center justify-between"><span class="column-title">${escapeAttr(col.label)}</span>${sortIcon}</div></th>`;
	});
	headerHtml += '</tr>';
	if ($thead.length) $thead.append(headerHtml);

	const $tbody = $('#' + idp(cid, 'table_body')); if (!$tbody.length) return;
	$tbody.empty();

	const virtualize = options.virtualize && st.filteredData.length > (options.virtualizeThreshold || 1000);
	if (virtualize) {
		const rh = st.virtualRowHeight;
		const $cont = $('#' + idp(cid, 'table_container'));
		const ch = $cont.innerHeight() || 400;
		const top = $cont.scrollTop() || 0;
		const visibleRows = Math.ceil(ch / rh) + st.virtualBuffer;
		const first = Math.max(0, Math.floor(top / rh) - st.virtualBuffer);
		const last = Math.min(pageData.length - 1, first + visibleRows);

		const topSpacer = first * rh;
		const bottomSpacer = (pageData.length - 1 - last) * rh;

		if (topSpacer > 0) $tbody.append(`<tr style="height:${topSpacer}px"><td></td></tr>`);
		for (let i = first; i <= last; i++) { $tbody.append(buildRowHtmlForInstance(cid, pageData[i], i + startIndex)); }
		if (bottomSpacer > 0) $tbody.append(`<tr style="height:${bottomSpacer}px"><td></td></tr>`);
	} else {
		pageData.forEach((row, idx) => $tbody.append(buildRowHtmlForInstance(cid, row, idx + startIndex)));
	}

	// row handlers within this instance only
	const $container = $('#' + cid);
	$container.find('.table-row').off('click').on('click', function () {
		$container.find('.table-row').removeClass('bg-blue-50').addClass('hover:bg-gray-50');
		$(this).removeClass('hover:bg-gray-50').addClass('bg-blue-50');
		const indice = $(this).data('indice');
		st.selectedIndice = indice;
		if (window.GLOBAL) window.GLOBAL.indiceFiche = indice;
		updateSelectedRowsForInstance(cid);
		try { if (typeof st.callbacks.onRowSelect === 'function') st.callbacks.onRowSelect(getPublicInstanceApi(cid), indice); } catch (e) { }
	});
	$container.find('.table-row').off('dblclick').on('dblclick', function () {
		const indice = $(this).data('indice');
		try { if (typeof st.callbacks.onRowDblClick === 'function') st.callbacks.onRowDblClick(getPublicInstanceApi(cid), indice); } catch (e) { }
	});

	if (options.enableColumnToggle !== false) initializeColumnDropdownForInstance(cid);

	if (options.orderByColumns) {
		$('#' + idp(cid, 'table_head')).off('click', 'th[data-column]').on('click', 'th[data-column]', function (e) {
			e.preventDefault();
			const k = $(this).data('column');
			const col = st.columnDefinitions[k]; if (!col) return;
			const current = st.sortState[k];
			const next = current === 'asc' ? 'desc' : current === 'desc' ? null : 'asc';
			Object.keys(st.sortState).forEach(x => st.sortState[x] = null);
			st.sortState[k] = next;
			if (next) st.filteredData = sortData(st.filteredData, col.key, next);
			else { st.filteredData = [...st.currentData]; applyFiltersForInstance(cid); return; }
			st.currentPage = 1;
			renderTableForInstance(cid); updatePaginationForInstance(cid); updateResultsCountForInstance(cid);
		});
	}

	if (typeof st.callbacks.onRenderComplete === 'function') { try { st.callbacks.onRenderComplete(getPublicInstanceApi(cid)); } catch (e) { } }
}

/* row builder */
function buildRowHtmlForInstance(cid, row, absoluteIndex) {
	const st = getInstanceState(cid);
	const keysSorted = Object.keys(st.columnDefinitions).sort((a, b) => { const ai = a.includes('indice'), bi = b.includes('indice'); if (ai && !bi) return -1; if (!ai && bi) return 1; return 0; });
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
			const mm = moment(val); if (mm.isValid()) val = mm.format('DD/MM/YYYY HH:mm');
		}
		if (st.options && st.options.badgeColumns && st.options.badgeColumns.some(b => col.key.toLowerCase().includes(String(b).toLowerCase()) || String(b).toLowerCase().includes(col.key.toLowerCase()))) {
			html += `<td class="px-3 py-3 whitespace-nowrap">${getStatusBadge(val)}</td>`;
		} else {
			const fw = col.key.toLowerCase().includes('indice') ? 'font-medium' : '';
			const strVal = String(val);

			// Amélioration: détection plus précise du texte qui peut déborder
			let isLong = false;
			let needsTruncate = false;

			if (strVal && strVal.length > 0) {
				// Texte long basé sur le nombre de caractères
				isLong = strVal.length > 20; // Réduit de 30 à 20 pour être plus strict

				// Pour les colonnes de commentaire, on tronque plus agressivement
				if (col.key.toLowerCase().includes('comment') || col.key.toLowerCase().includes('detail')) {
					needsTruncate = strVal.length > 15; // Très strict pour les commentaires
					isLong = strVal.length > 10; // Tooltip dès 10 caractères pour les commentaires
				} else {
					needsTruncate = isLong;
				}
			}

			const trunc = needsTruncate ? 'truncate' : '';
			const tt = isLong && st.options && st.options.enableTooltip ? ` data-tooltip="${escapeAttr(strVal)}"` : '';
			html += `<td class="px-3 py-3 whitespace-nowrap text-sm text-gray-900 ${fw} ${trunc}"${tt}>${escapeAttr(strVal)}</td>`;
		}
	});
	html += '</tr>';
	return html;
}

/* ====== Filtering / search ====== */
function applyFiltersForInstance(cid) {
	const st = getInstanceState(cid);
	const filters = {};
	Object.keys(st.columnDefinitions).forEach(k => {
		const $el = $('#' + idp(cid, `filter_${k}`)); if ($el.length) { const v = $el.val(); if (v) filters[k] = String(v).toLowerCase(); }
	});

	st.filteredData = st.currentData.filter(row => {
		const fm = Object.keys(filters).every(k => {
			const col = st.columnDefinitions[k]; const fv = filters[k]; const rv = row[col.key];
			if (!rv) return false;
			if (col.key.toLowerCase().includes('tel')) return String(rv).replace(/\s/g, '').toLowerCase().includes(fv.replace(/\s/g, ''));
			return String(rv).toLowerCase().includes(fv);
		});
		const gsEl = $('#' + idp(cid, 'global_search')); const gsv = gsEl.length ? String(gsEl.val()).toLowerCase() : '';
		if (gsv) {
			const gm = Object.keys(st.columnDefinitions).some(k => {
				if (!st.visibleColumns[k]) return false;
				const col = st.columnDefinitions[k]; const rv = row[col.key]; if (!rv) return false;
				if (col.key.toLowerCase().includes('tel')) return String(rv).replace(/\s/g, '').toLowerCase().includes(gsv.replace(/\s/g, ''));
				return String(rv).toLowerCase().includes(gsv);
			});
			return fm && gm;
		}
		return fm;
	});

	st.currentPage = 1;
	const active = Object.keys(st.sortState).find(k => st.sortState[k]);
	if (active) { const col = st.columnDefinitions[active]; if (col) st.filteredData = sortData(st.filteredData, col.key, st.sortState[active]); }
	renderTableForInstance(cid); updatePaginationForInstance(cid); updateResultsCountForInstance(cid);
}
function applyGlobalSearchForInstance(cid) { applyFiltersForInstance(cid); }

/* ====== Pagination & counts ====== */
function updatePaginationForInstance(cid) {
	const st = getInstanceState(cid);
	const totalPages = Math.max(1, Math.ceil(st.filteredData.length / st.itemsPerPage));
	$('#' + idp(cid, 'current_page')).text(st.currentPage);
	$('#' + idp(cid, 'total_pages')).text(totalPages);
	$('#' + idp(cid, 'prev_page')).prop('disabled', st.currentPage === 1);
	$('#' + idp(cid, 'next_page')).prop('disabled', st.currentPage === totalPages);

	const $nums = $('#' + idp(cid, 'page_numbers')); $nums.empty();
	const addBtn = (p, active = false, dots = false) => {
		if (dots) $nums.append('<span class="px-2 text-xs text-gray-400">...</span>');
		else if (active) $nums.append(`<button class="px-2 py-1 text-xs text-white ${getCurrentPalette(st.options).buttonBg} rounded">${p}</button>`);
		else $nums.append(`<button class="px-2 py-1 text-xs page-btn border border-gray-300 rounded hover:bg-gray-50" data-page="${p}">${p}</button>`);
	};
	if (totalPages >= 1) addBtn(1, st.currentPage === 1);
	const d = 1; const rs = Math.max(2, st.currentPage - d), re = Math.min(totalPages - 1, st.currentPage + d);
	if (rs > 2) addBtn(null, false, true);
	for (let i = rs; i <= re; i++) { if (i !== 1 && i !== totalPages) addBtn(i, i === st.currentPage); }
	if (re < totalPages - 1) addBtn(null, false, true);
	if (totalPages > 1) addBtn(totalPages, st.currentPage === totalPages);

	$('.page-btn').off('click').on('click', function () { st.currentPage = parseInt($(this).data('page'), 10); renderTableForInstance(cid); updatePaginationForInstance(cid); updateResultsCountForInstance(cid); });
}
function updateResultsCountForInstance(cid) {
	const st = getInstanceState(cid);
	const total = st.currentData.length, filtered = st.filteredData.length;
	const start = filtered === 0 ? 0 : (st.currentPage - 1) * st.itemsPerPage + 1;
	const end = filtered === 0 ? 0 : Math.min(start + st.itemsPerPage - 1, filtered);
	$('#' + idp(cid, 'results_count')).text(`${filtered} résultats sur ${total}`);
	$('#' + idp(cid, 'results_summary')).text(filtered > 0 ? `Affichage de ${start} à ${end} sur ${filtered} résultats` : 'Aucun résultat');
}

/* ====== Selection helpers ====== */
function updateSelectedRowsForInstance(cid) {
	const st = getInstanceState(cid);
	const has = st.selectedIndice != null;
	$('#' + idp(cid, 'btn_fiche')).prop('disabled', !has);
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
function virtualOnScrollHandler(cid) { renderTableForInstance(cid); }

/* ====== Sort helper ====== */
function sortData(data, columnKey, direction) {
	if (!direction) return data;
	return [...data].sort((a, b) => {
		let av = a[columnKey], bv = b[columnKey];
		if (av == null) av = ''; if (bv == null) bv = '';
		const low = columnKey.toLowerCase();
		if (low.includes('indice') || low.includes('priorite')) { av = parseFloat(av) || 0; bv = parseFloat(bv) || 0; return direction === 'asc' ? av - bv : bv - av; }
		if (low.includes('date') || low.includes('appel')) { const ad = moment(av), bd = moment(bv); if (ad.isValid() && bd.isValid()) return direction === 'asc' ? ad - bd : bd - ad; }
		av = String(av).toLowerCase(); bv = String(bv).toLowerCase(); return direction === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
	});
}

/* ====== Badges ====== */
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

/* ====== Sample data (dev) ====== */
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
		const d = { ...base }; d.Indice = 217570 + i; d.Agent = agents[i % agents.length]; d.Statut = statuts[i % statuts.length];
		d.contact_ville = villes[i % villes.length]; d["Nom société"] = soc[i % soc.length];
		d["Date appel"] = `2024-06-${String(25 + (i % 5)).padStart(2, '0')} ${String(9 + (i % 12)).padStart(2, '0')}:${String(15 + (i % 45)).padStart(2, '0')}`;
		d.PRIORITE = (i % 5) - 1; d.Commentaire = i % 3 === 0 ? "Client intéressé ".repeat(22).trim() : i % 3 === 1 ? "À rappeler" : "";
		d["Tel port"] = i % 2 === 0 ? `06 ${String(10 + (i % 89)).padStart(2, '0')} ${String(10 + (i % 89)).padStart(2, '0')}` : "";
		d.montant = i % 4 === 0 ? String((i + 1) * 1000) : "";
		arr.push(d);
	}
	initializeColumnsForInstance(cid, arr, st.options || {});
	generateDynamicFiltersForInstance(cid);
	if (st.options && st.options.enableColumnToggle !== false) initializeColumnDropdownForInstance(cid);
	st.currentData = arr; st.filteredData = [...st.currentData];
	renderTableForInstance(cid); updatePaginationForInstance(cid); updateResultsCountForInstance(cid);
	afficheTableauChargementForInstance(cid, false);
	$('#' + idp(cid, 'btn_fiche')).prop('disabled', true);
}

/* ====== JSON loader ====== */
function loadDataFromJSONForInstance(cid, json) {
	if (!Array.isArray(json)) { console.error('loadDataFromJSONForInstance expects array'); return; }
	const st = getInstanceState(cid);
	st.currentData = json; st.filteredData = [...st.currentData]; st.currentPage = 1;
	initializeColumnsForInstance(cid, st.currentData, st.options || {});
	generateDynamicFiltersForInstance(cid);
	if (st.options && st.options.enableColumnToggle !== false) initializeColumnDropdownForInstance(cid);
	renderTableForInstance(cid); updatePaginationForInstance(cid); updateResultsCountForInstance(cid);
	afficheTableauChargementForInstance(cid, false);
	$('#' + idp(cid, 'btn_fiche')).prop('disabled', true);
}

/* ====== Loading indicator ====== */
function afficheTableauChargementForInstance(cid, show) {
	if (show) { $('#' + idp(cid, 'table_container')).hide(); $('#' + idp(cid, 'loading-spinner')).removeClass('hidden'); }
	else { $('#' + idp(cid, 'table_container')).show(); $('#' + idp(cid, 'loading-spinner')).addClass('hidden'); }
}

/* ====== Export ====== */
function exportCSVForInstance(cid) {
	const st = getInstanceState(cid);
	const cols = Object.keys(st.columnDefinitions).filter(k => st.visibleColumns[k]);
	if (cols.length === 0) { alert('Aucune colonne visible à exporter'); return; }
	const header = cols.map(k => `"${st.columnDefinitions[k].label.replace(/"/g, '""')}"`).join(',');
	const rows = st.filteredData.map(row => cols.map(k => { const v = row[st.columnDefinitions[k].key]; return `"${(v == null ? '' : String(v)).replace(/"/g, '""')}"`; }).join(','));
	const csv = [header].concat(rows).join('\r\n');
	const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob);
	const a = document.createElement('a'); a.href = url; a.download = `${cid}_export.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function exportExcelForInstance(cid) {
	const st = getInstanceState(cid);
	const cols = Object.keys(st.columnDefinitions).filter(k => st.visibleColumns[k]); if (cols.length === 0) { alert('Aucune colonne visible à exporter'); return; }
	const header = cols.map(k => st.columnDefinitions[k].label).join('\t');
	const rows = st.filteredData.map(row => cols.map(k => row[st.columnDefinitions[k].key] ?? '').join('\t'));
	const tsv = [header].concat(rows).join('\r\n');
	const blob = new Blob([tsv], { type: 'application/vnd.ms-excel;charset=utf-8;' }); const url = URL.createObjectURL(blob);
	const a = document.createElement('a'); a.href = url; a.download = `${cid}_export.xls`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

/* ====== Public API per instance ====== */
function getPublicInstanceApi(cid) {
	return {
		updateData: (newData) => { initTableRechercheForInstance(Array.isArray(newData) ? newData : [newData], { ...(getInstanceState(cid).options || {}), containerId: cid }); },
		loadJSON: (json) => { loadDataFromJSONForInstance(cid, json); },
		selectIndice: (indice) => { const st = getInstanceState(cid); st.selectedIndice = indice; if (window.GLOBAL) window.GLOBAL.indiceFiche = indice; updateSelectedRowsForInstance(cid); },
		getSelectedIndice: () => getInstanceState(cid).selectedIndice,
		getLastTel: () => getInstanceState(cid).lastTel,
		getState: () => getInstanceState(cid),
		exportCSV: () => exportCSVForInstance(cid),
		exportExcel: () => exportExcelForInstance(cid),
		on: function (eventName, fn) { const st = getInstanceState(cid); st.callbacks[eventName] = fn; return this; }
	};
}

/* ====== createTable (entry) ====== */
function createTable(options = {}) {
	if (!options.containerId) { console.error('createTable: options.containerId is required'); return; }
	const cid = options.containerId;
	const st = getInstanceState(cid);

	options.theme = options.theme || 'default';
	options.badgeColumns = options.badgeColumns || ['Statut'];
	options.orderByColumns = options.orderByColumns !== false;
	options.enablePageSizeSelector = options.enablePageSizeSelector !== false;
	options.enableSearch = options.enableSearch !== false;
	options.enableTooltip = options.enableTooltip !== false;
	options.virtualizeThreshold = options.virtualizeThreshold || 1000;
	options.legacyShim = options.hasOwnProperty('legacyShim') ? options.legacyShim : true;

	st.options = options; st.currentPage = 1; st.itemsPerPage = options.itemsPerPageCount || st.itemsPerPage;
	if (options.colorPalette && Array.isArray(options.colorPalette) && options.colorPalette.length === 2) {
		options.customPalette = { headerBg: options.colorPalette[0], buttonBg: options.colorPalette[1], buttonHover: generateHoverClass(options.colorPalette[1]) };
	}

	afficheRechercheTableau(options);
	initTableRechercheForInstance(Array.isArray(options.data) ? options.data : (options.data ? [options.data] : []), options);

	const api = getPublicInstanceApi(cid);
	window.createTableInstances = window.createTableInstances || {};
	window.createTableInstances[cid] = api;
	return api;
}

// expose globally
window.createTable = createTable;
window.libTableFimainfo = window.libTableFimainfo || {};
window.libTableFimainfo.getInstanceState = getInstanceState;
window.libTableFimainfo.createTable = createTable;

/* ====== END OF FILE ====== */
