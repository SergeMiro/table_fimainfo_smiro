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

// Simple tooltip fallback - Design amélioré
function initializeSimpleTooltips() {
	console.log('Initialisation des tooltips simples...');

	if (document.getElementById('simple-tooltip')) {
		document.getElementById('simple-tooltip').remove();
	}

	const tooltip = document.createElement('div');
	tooltip.id = 'simple-tooltip';
	tooltip.className = [
		'pointer-events-none select-none z-[9999] fixed',
		'rounded-xl px-4 py-3 text-sm font-medium max-w-sm',
		'bg-white/95 backdrop-blur-md text-gray-800 shadow-2xl border border-gray-200',
		'opacity-0 transform scale-95 transition-all duration-300 ease-out',
		'whitespace-normal break-words'
	].join(' ');
	tooltip.style.backdropFilter = 'blur(12px)';
	document.body.appendChild(tooltip);

	let currentElement = null;

	function showTooltip(element) {
		const content = element.getAttribute('data-tooltip');
		if (!content) return;

		tooltip.textContent = content;
		tooltip.style.display = 'block';

		// Animation d'entrée fluide
		requestAnimationFrame(() => {
			tooltip.style.opacity = '1';
			tooltip.style.transform = 'scale(1)';
		});

		const rect = element.getBoundingClientRect();
		const tooltipRect = tooltip.getBoundingClientRect();

		let top = rect.top - tooltipRect.height - 12;
		let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);

		// Ajustements pour rester dans la fenêtre
		if (top < 12) {
			top = rect.bottom + 12;
		}
		if (left < 12) {
			left = 12;
		}
		if (left + tooltipRect.width > window.innerWidth - 12) {
			left = window.innerWidth - tooltipRect.width - 12;
		}

		tooltip.style.top = top + 'px';
		tooltip.style.left = left + 'px';
	}

	function hideTooltip() {
		tooltip.style.opacity = '0';
		tooltip.style.transform = 'scale(0.95)';
		setTimeout(() => {
			if (tooltip.style.opacity === '0') {
				tooltip.style.display = 'none';
			}
		}, 300);
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
    <div class="bg-white rounded-xl shadow-2xl border border-gray-100 w-full mx-auto transform transition-all duration-300 hover:shadow-3xl">
      <!-- Header -->
      <div class="px-6 py-5 border-b border-gray-100 ${palette.headerBg} rounded-t-xl bg-gradient-to-r from-gray-50 to-blue-50">
        <div class="flex items-center justify-between">
          ${options.enableSearch !== false ? `
            <div class="flex-1 max-w-md mr-6">
              <div class="relative group">
                <input type="text" id="${idp(cid, 'global_search')}" placeholder="Rechercher dans tous les champs affichés ..." class="pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm w-full focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all duration-200 bg-white/80 backdrop-blur-sm shadow-sm hover:shadow-md">
                <svg class="absolute left-3 top-3 w-4 h-4 text-gray-400 group-focus-within:text-blue-500 transition-colors duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              </div>
            </div>` : ''}
          ${options.enableColumnToggle !== false ? `
            <div class="relative">
              <button id="${idp(cid, 'columns_toggle')}" class="inline-flex items-center px-4 py-2.5 text-sm font-medium text-gray-700 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg hover:bg-white hover:border-gray-300 hover:shadow-md transition-all duration-200 transform hover:scale-105">
                <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 616 0z"/></svg>
                Colonnes
                <svg class="w-4 h-4 ml-2 transition-transform duration-200" id="${idp(cid, 'columns_toggle_icon')}" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
              </button>
              <div id="${idp(cid, 'columns_dropdown')}" class="hidden absolute right-0 mt-3 w-64 bg-white/95 backdrop-blur-lg rounded-xl shadow-2xl border border-gray-100 z-50 transform scale-95 opacity-0 transition-all duration-200">
                <div class="py-3">
                  <div id="${idp(cid, 'column_dropdown_title')}" class="px-5 py-3 text-xs font-semibold text-gray-600 uppercase tracking-wider border-b border-gray-50 bg-gray-25">Colonnes affichées</div>
                  <div id="${idp(cid, 'column_checkboxes')}" class="py-2 max-h-64 overflow-y-auto custom-scrollbar"></div>
                </div>
              </div>
            </div>` : ''}
        </div>
      </div>

      <!-- Filters -->
      ${options.enableFilters !== false ? `
      <div id="${idp(cid, 'filters_container')}" class="px-6 py-5 bg-gradient-to-r from-gray-25 to-blue-25 border-b border-gray-100">
        <div id="${idp(cid, 'filters_grid')}" class="grid gap-4"></div>
      </div>` : ''}

      <!-- Summary -->
      <div class="px-6 py-4 bg-gradient-to-r from-white to-gray-25 border-b border-gray-100">
        <div class="flex items-center justify-between">
          <span id="${idp(cid, 'results_count')}" class="text-sm font-medium text-gray-700 bg-white/60 px-3 py-1.5 rounded-full shadow-sm">0 résultats sur 0</span>
          <span id="${idp(cid, 'results_summary')}" class="text-sm font-medium text-blue-700 bg-blue-50/60 px-3 py-1.5 rounded-full shadow-sm">Affichage de 0 à 0 sur 0 résultats</span>
        </div>
      </div>

      <!-- Loading -->
      <div id="${idp(cid, 'loading-spinner')}" class="hidden px-6 py-16">
        <div class="flex flex-col justify-center items-center">
          <div class="animate-spin rounded-full h-12 w-12 border-4 border-blue-100 border-t-blue-500 shadow-lg"></div>
          <p class="mt-4 text-sm text-gray-500 font-medium">Chargement des données...</p>
        </div>
      </div>

      <!-- Table -->
      <div id="${idp(cid, 'table_container')}" class="overflow-hidden rounded-b-xl" style="max-height:520px;">
        <style>
          .custom-scrollbar::-webkit-scrollbar { width: 8px; height: 8px; }
          .custom-scrollbar::-webkit-scrollbar-track { background: #f8fafc; border-radius: 8px; }
          .custom-scrollbar::-webkit-scrollbar-thumb { background: linear-gradient(to bottom, #cbd5e0, #a0aec0); border-radius: 8px; }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: linear-gradient(to bottom, #a0aec0, #718096); }
          .table-row { transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1); }
          .table-row:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); }
        </style>
        <div class="overflow-auto custom-scrollbar" style="max-height:520px;">
          <table style="width:100%; table-layout:fixed; min-width:${minWidth}px;" class="divide-y divide-gray-100">
            <thead id="${idp(cid, 'table_head')}" class="bg-gradient-to-r from-gray-50 to-blue-50 sticky top-0 z-10"></thead>
            <tbody id="${idp(cid, 'table_body')}" class="bg-white divide-y divide-gray-100"></tbody>
          </table>
        </div>
      </div>

      <!-- Pagination -->
      <div class="px-6 py-5 bg-gradient-to-r from-gray-25 to-white border-t border-gray-100 rounded-b-xl">
        <div class="flex items-center justify-between">
          <div class="flex items-center space-x-6">
            ${options.enablePageSizeSelector !== false ? `
            <div class="flex items-center space-x-3">
              <label for="${idp(cid, 'page_size_selector')}" class="text-sm font-medium text-gray-700">Éléments par page:</label>
              <div class="relative">
                <select id="${idp(cid, 'page_size_selector')}" class="text-sm border border-gray-200 rounded-lg px-3 py-2 pr-8 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 appearance-none bg-white/80 backdrop-blur-sm shadow-sm hover:shadow-md transition-all duration-200">
                  ${[5, 10, 20, 50, 100].map(s => `<option value="${s}" ${state.itemsPerPage === s ? 'selected' : ''}>${s}</option>`).join('')}
                </select>
                <svg class="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>
              </div>
            </div>` : ''}
            <div class="text-sm font-medium text-gray-700 bg-white/60 px-3 py-2 rounded-lg shadow-sm">Page <span id="${idp(cid, 'current_page')}" class="font-bold text-blue-600">1</span> sur <span id="${idp(cid, 'total_pages')}" class="font-bold text-blue-600">1</span></div>
          </div>
          <div class="flex items-center space-x-2">
            <button id="${idp(cid, 'prev_page')}" class="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-600 bg-white/80 backdrop-blur-sm border border-gray-200 rounded-lg hover:bg-white hover:border-gray-300 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-105">
              <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg> Précédent
            </button>
            <div id="${idp(cid, 'page_numbers')}" class="flex items-center space-x-1"></div>
            <button id="${idp(cid, 'next_page')}" class="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-600 bg-white/80 backdrop-blur-sm border border-gray-200 rounded-lg hover:bg-white hover:border-gray-300 hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-105">
              Suivant <svg class="w-4 h-4 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- Actions -->
      ${options.enableActionButton !== false ? `
      <div class="px-6 py-5 border-t border-gray-100 bg-gradient-to-r from-white to-gray-25 rounded-b-xl">
        <div class="flex items-center space-x-4">
          <button id="${idp(cid, 'btn_fiche')}" class="inline-flex items-center px-6 py-3 text-sm font-semibold text-white bg-gradient-to-r from-blue-500 to-blue-600 border border-transparent rounded-xl hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-105 shadow-lg hover:shadow-xl" disabled>
            <svg class="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 616 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
            Voir la fiche
          </button>
          <button id="${idp(cid, 'export_csv')}" class="inline-flex items-center px-4 py-2.5 text-sm font-medium text-gray-700 bg-white/80 backdrop-blur-sm border border-gray-200 rounded-lg hover:bg-white hover:border-gray-300 hover:shadow-md transition-all duration-200 transform hover:scale-105">
            <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            Export CSV
          </button>
          <button id="${idp(cid, 'export_xls')}" class="inline-flex items-center px-4 py-2.5 text-sm font-medium text-gray-700 bg-white/80 backdrop-blur-sm border border-gray-200 rounded-lg hover:bg-white hover:border-gray-300 hover:shadow-md transition-all duration-200 transform hover:scale-105">
            <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            Export Excel
          </button>
        </div>
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

	// Column toggle avec animations fluides
	if (columnsToggle && columnsDropdown) {
		const toggleIcon = document.getElementById(idp(cid, 'columns_toggle_icon'));

		columnsToggle.addEventListener('click', (e) => {
			e.stopPropagation();
			const isHidden = columnsDropdown.classList.contains('hidden');

			if (isHidden) {
				// Animation d'ouverture
				columnsDropdown.classList.remove('hidden');
				if (toggleIcon) toggleIcon.style.transform = 'rotate(180deg)';
				requestAnimationFrame(() => {
					columnsDropdown.style.opacity = '1';
					columnsDropdown.style.transform = 'scale(1)';
				});
			} else {
				// Animation de fermeture
				if (toggleIcon) toggleIcon.style.transform = 'rotate(0deg)';
				columnsDropdown.style.opacity = '0';
				columnsDropdown.style.transform = 'scale(0.95)';
				setTimeout(() => {
					columnsDropdown.classList.add('hidden');
				}, 200);
			}
		});

		document.addEventListener('click', (e) => {
			if (!e.target.closest(`#${idp(cid, 'columns_toggle')}, #${idp(cid, 'columns_dropdown')}`)) {
				if (toggleIcon) toggleIcon.style.transform = 'rotate(0deg)';
				columnsDropdown.style.opacity = '0';
				columnsDropdown.style.transform = 'scale(0.95)';
				setTimeout(() => {
					columnsDropdown.classList.add('hidden');
				}, 200);
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
	checkboxContainer.innerHTML = '';

	const sortedKeys = Object.keys(state.columnDefinitions).sort((a, b) => {
		const ai = a.includes('indice'), bi = b.includes('indice');
		if (ai && !bi) return -1;
		if (!ai && bi) return 1;
		return 0;
	});

	sortedKeys.forEach((k) => {
		const col = state.columnDefinitions[k];
		const checked = state.visibleColumns[k] !== false ? 'checked' : '';
		const labelEl = document.createElement('label');
		labelEl.className = 'flex items-center px-5 py-3 hover:bg-gradient-to-r hover:from-blue-25 hover:to-blue-50 cursor-pointer transition-all duration-200 rounded-lg mx-2';
		labelEl.innerHTML = `
			<div class="relative mr-3">
				<input type="checkbox" ${checked} class="sr-only" data-column="${k}">
				<div class="checkbox-custom w-5 h-5 bg-white border-2 border-gray-300 rounded transition-all duration-200 hover:border-blue-400 ${checked ? 'bg-blue-500 border-blue-500' : ''}">
					${checked ? '<svg class="w-3 h-3 text-white absolute top-0.5 left-0.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg>' : ''}
				</div>
			</div>
			<span class="text-sm font-medium text-gray-700 select-none">${col.label}</span>
		`;
		checkboxContainer.appendChild(labelEl);
	});

	updateColumnDropdownTitleForInstance(cid);

	// Gestion des checkboxes avec animations
	checkboxContainer.addEventListener('click', function (e) {
		const label = e.target.closest('label');
		if (!label) return;

		const checkbox = label.querySelector('input[type="checkbox"]');
		const checkboxCustom = label.querySelector('.checkbox-custom');
		if (!checkbox || !checkboxCustom) return;

		e.preventDefault();

		const k = checkbox.dataset.column;
		const newValue = !checkbox.checked;

		// Animation de transition
		checkboxCustom.style.transform = 'scale(0.9)';

		setTimeout(() => {
			checkbox.checked = newValue;
			state.visibleColumns[k] = newValue;

			// Mise à jour visuelle du checkbox
			if (newValue) {
				checkboxCustom.className = 'checkbox-custom w-5 h-5 bg-blue-500 border-2 border-blue-500 rounded transition-all duration-200 hover:border-blue-400';
				checkboxCustom.innerHTML = '<svg class="w-3 h-3 text-white absolute top-0.5 left-0.5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"></path></svg>';
			} else {
				checkboxCustom.className = 'checkbox-custom w-5 h-5 bg-white border-2 border-gray-300 rounded transition-all duration-200 hover:border-blue-400';
				checkboxCustom.innerHTML = '';
			}

			checkboxCustom.style.transform = 'scale(1)';

			persistSettings(cid, state);
			updateColumnDropdownTitleForInstance(cid);
			renderTableForInstance(cid);
		}, 100);
	});
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
      <input type="text" id="${fid}" placeholder="${escapeAttr(col.label)}" class="pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg text-sm w-full focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all duration-200 bg-white/80 backdrop-blur-sm shadow-sm hover:shadow-md">
      <svg class="absolute left-3 top-3 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
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
		const sortDir = st.sortState[k];
		let sortIcon = '';
		if (options.orderByColumns !== false) {
			if (sortDir === 'asc') sortIcon = '<svg class="w-4 h-4 ml-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/></svg>';
			else if (sortDir === 'desc') sortIcon = '<svg class="w-4 h-4 ml-1 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>';
			else sortIcon = '<svg class="w-4 h-4 ml-1 inline opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/></svg>';
		}
		headerHtml += `<th class="px-4 py-4 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider cursor-pointer bg-gradient-to-r from-gray-50 to-blue-50 hover:from-blue-50 hover:to-blue-100 transition-all duration-200 border-r border-gray-100 last:border-r-0" style="width:${widthPercent}" data-column="${k}"><div class="flex items-center justify-between group"><span class="column-title group-hover:text-blue-700 transition-colors duration-200">${escapeAttr(col.label)}</span><span class="sort-icon group-hover:text-blue-600 transition-colors duration-200">${sortIcon}</span></div></th>`;
	});
	headerHtml += '</tr>';

	console.log('📝 Header HTML généré:', headerHtml.length, 'caractères');
	if (thead) thead.innerHTML = headerHtml;

	const tbody = document.getElementById(idp(cid, 'table_body'));
	console.log('🔍 tbody trouvé:', !!tbody, 'ID:', idp(cid, 'table_body'));
	if (!tbody) return;
	tbody.innerHTML = '';

	pageData.forEach((row, idx) => {
		tbody.insertAdjacentHTML('beforeend', buildRowHtmlForInstance(cid, row, idx + startIndex));
	});

	// Row handlers with vanilla JS
	const container = document.getElementById(cid);
	if (container) {
		// Click handler with event delegation
		container.addEventListener('click', function (event) {
			const clickedRow = event.target.closest('.table-row');
			if (!clickedRow) return;

			// Remove selection from all rows
			const allRows = container.querySelectorAll('.table-row');
			allRows.forEach(row => {
				row.classList.remove('bg-blue-50');
				row.classList.add('hover:bg-gray-50');
			});

			// Select current row
			clickedRow.classList.remove('hover:bg-gray-50');
			clickedRow.classList.add('bg-blue-50');

			const indice = clickedRow.dataset.indice;
			st.selectedIndice = indice;
			if (window.GLOBAL) window.GLOBAL.indiceFiche = indice;
			updateSelectedRowsForInstance(cid);
			try {
				if (typeof st.callbacks.onRowSelect === 'function')
					st.callbacks.onRowSelect(getPublicInstanceApi(cid), indice);
			} catch (e) { }
		});

		// Double click handler
		container.addEventListener('dblclick', function (event) {
			const clickedRow = event.target.closest('.table-row');
			if (!clickedRow) return;

			const indice = clickedRow.dataset.indice;
			try {
				if (typeof st.callbacks.onRowDblClick === 'function')
					st.callbacks.onRowDblClick(getPublicInstanceApi(cid), indice);
			} catch (e) { }
		});
	}

	if (options.enableColumnToggle !== false) initializeColumnDropdownForInstance(cid);

	if (options.orderByColumns !== false && thead) {
		thead.addEventListener('click', function (event) {
			const clickedTh = event.target.closest('th[data-column]');
			if (!clickedTh) return;

			event.preventDefault();
			const k = clickedTh.dataset.column;
			const col = st.columnDefinitions[k];
			if (!col) return;

			const current = st.sortState[k];
			const next = current === 'asc' ? 'desc' : current === 'desc' ? null : 'asc';
			Object.keys(st.sortState).forEach(x => st.sortState[x] = null);
			st.sortState[k] = next;

			if (next) st.filteredData = sortData(st.filteredData, col.key, next);
			else {
				st.filteredData = [...st.currentData];
				applyFiltersForInstance(cid);
				return;
			}
			st.currentPage = 1;
			renderTableForInstance(cid);
			updatePaginationForInstance(cid);
			updateResultsCountForInstance(cid);
		});
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

	let html = `<tr class="cursor-pointer table-row border-b border-gray-50 transition-all duration-200 ease-out hover:bg-gradient-to-r hover:from-blue-25 hover:to-blue-50 hover:shadow-lg hover:border-blue-200 ${isSelected ? 'bg-gradient-to-r from-blue-50 to-blue-100 border-blue-200 shadow-md' : ''}" data-index="${absoluteIndex}" data-indice="${escapeAttr(indiceValue)}">`;
	keysSorted.forEach((k) => {
		if (!st.visibleColumns[k]) return;
		const col = st.columnDefinitions[k];
		let val = row[col.key] ?? '';
		if (col.key.toLowerCase().includes('tel') && val) val = String(val).replace(/\s/g, '');
		if ((col.key.toLowerCase().includes('date') || col.key.toLowerCase().includes('appel')) && val) {
			const mm = moment(val); if (mm.isValid()) val = mm.format('DD/MM/YYYY HH:mm');
		}
		if (st.options && (st.options.badgeColumns || st.options.badgeCounts) &&
			(st.options.badgeColumns || st.options.badgeCounts || []).some(b => col.key.toLowerCase().includes(String(b).toLowerCase()) || String(b).toLowerCase().includes(col.key.toLowerCase()))) {
			html += `<td class="px-4 py-4 whitespace-nowrap border-r border-gray-50 last:border-r-0">${getStatusBadge(val)}</td>`;
		} else {
			const fw = col.key.toLowerCase().includes('indice') ? 'font-semibold text-blue-700' : 'font-medium';
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
			html += `<td class="px-4 py-4 whitespace-nowrap text-sm text-gray-800 ${fw} ${trunc} border-r border-gray-50 last:border-r-0 group-hover:text-gray-900 transition-colors duration-200"${tt}>${escapeAttr(strVal)}</td>`;
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
			const rv = row[col.key];
			if (!rv) return false;
			if (col.key.toLowerCase().includes('tel')) return String(rv).replace(/\s/g, '').toLowerCase().includes(fv.replace(/\s/g, ''));
			return String(rv).toLowerCase().includes(fv);
		});

		const gsEl = document.getElementById(idp(cid, 'global_search'));
		const gsv = gsEl ? String(gsEl.value).toLowerCase() : '';
		if (gsv) {
			const gm = Object.keys(st.columnDefinitions).some(k => {
				if (!st.visibleColumns[k]) return false;
				const col = st.columnDefinitions[k];
				const rv = row[col.key];
				if (!rv) return false;
				if (col.key.toLowerCase().includes('tel')) return String(rv).replace(/\s/g, '').toLowerCase().includes(gsv.replace(/\s/g, ''));
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
			btn.className = 'px-3 py-2 text-sm font-semibold text-white bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg shadow-md border border-blue-600 transform scale-105';
			btn.textContent = p;
			nums.appendChild(btn);
		} else {
			const btn = document.createElement('button');
			btn.className = 'px-3 py-2 text-sm font-medium page-btn border border-gray-200 rounded-lg hover:bg-gradient-to-r hover:from-blue-50 hover:to-blue-100 hover:border-blue-300 transition-all duration-200 transform hover:scale-105 shadow-sm hover:shadow-md bg-white/80 backdrop-blur-sm';
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

/* ====== Sort helper - IDENTIQUE ====== */
function sortData(data, columnKey, direction) {
	if (!direction) return data;
	return [...data].sort((a, b) => {
		let av = a[columnKey], bv = b[columnKey];
		if (av == null) av = '';
		if (bv == null) bv = '';
		const low = columnKey.toLowerCase();
		if (low.includes('indice') || low.includes('priorite')) {
			av = parseFloat(av) || 0;
			bv = parseFloat(bv) || 0;
			return direction === 'asc' ? av - bv : bv - av;
		}
		if (low.includes('date') || low.includes('appel')) {
			const ad = moment(av), bd = moment(bv);
			if (ad.isValid() && bd.isValid()) return direction === 'asc' ? ad - bd : bd - ad;
		}
		av = String(av).toLowerCase();
		bv = String(bv).toLowerCase();
		return direction === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
	});
}

/* ====== Badges - Design Amélioré ====== */
function getStatusBadge(status) {
	if (!status) return `<span class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 shadow-sm border border-gray-200 transition-all duration-200 hover:shadow-md transform hover:scale-105">${status || 'N/A'}</span>`;
	const s = String(status).toLowerCase();
	if (s.includes('rappel')) return `<span class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-yellow-100 to-yellow-200 text-yellow-800 shadow-sm border border-yellow-300 transition-all duration-200 hover:shadow-md transform hover:scale-105">${escapeAttr(status)}</span>`;
	if (s.includes('rdv')) return `<span class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-blue-100 to-blue-200 text-blue-800 shadow-sm border border-blue-300 transition-all duration-200 hover:shadow-md transform hover:scale-105">${escapeAttr(status)}</span>`;
	if (s.includes('relance')) return `<span class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-purple-100 to-purple-200 text-purple-800 shadow-sm border border-purple-300 transition-all duration-200 hover:shadow-md transform hover:scale-105">${escapeAttr(status)}</span>`;
	if (s.includes('absent') || s.includes('non répondu')) return `<span class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-red-100 to-red-200 text-red-800 shadow-sm border border-red-300 transition-all duration-200 hover:shadow-md transform hover:scale-105">${escapeAttr(status)}</span>`;
	if (s.includes('refus') || s.includes('négatif')) return `<span class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-orange-100 to-orange-200 text-orange-800 shadow-sm border border-orange-300 transition-all duration-200 hover:shadow-md transform hover:scale-105">${escapeAttr(status)}</span>`;
	if (s.includes('positif') || s.includes('accepté') || s.includes('validé')) return `<span class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-green-100 to-green-200 text-green-800 shadow-sm border border-green-300 transition-all duration-200 hover:shadow-md transform hover:scale-105">${escapeAttr(status)}</span>`;
	if (s.includes('en cours') || s.includes('traitement')) return `<span class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-cyan-100 to-cyan-200 text-cyan-800 shadow-sm border border-cyan-300 transition-all duration-200 hover:shadow-md transform hover:scale-105">${escapeAttr(status)}</span>`;
	if (s.includes('urgent') || s.includes('priorité')) return `<span class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-pink-100 to-pink-200 text-pink-800 shadow-sm border border-pink-300 transition-all duration-200 hover:shadow-md transform hover:scale-105">${escapeAttr(status)}</span>`;
	return `<span class="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-gradient-to-r from-gray-100 to-gray-200 text-gray-700 shadow-sm border border-gray-200 transition-all duration-200 hover:shadow-md transform hover:scale-105">${escapeAttr(status)}</span>`;
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
