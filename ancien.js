/*
 * =============================================================================
 * TABLEAU DE RECHERCHE INTERACTIF - TAILWIND CSS
 * =============================================================================
 *
 * Créé par: Sergiy MIROCHNYK
 * Date: 09/09/2025
 *
 *
 * Fonctionnalités principales:
 * - Recherche globale et par colonne
 * - Tri par colonnes (asc/desc)
 * - Pagination avec sélecteur de taille
 * - Gestion dynamique des colonnes
 * - Thèmes et palettes de couleurs
 * - Tooltips et badges de statut
 * - Support responsive
 *
 * Technologies utilisées:
 * - JavaScript ES6+
 * - jQuery
 * - Tailwind CSS
 * - Moment.js
 * - Floating UI
 *
 * =============================================================================
 */

//TODO créer export CSV + Excel

/* ====== Variables d'état globales ====== */
var tableId_recherche = 'table_fimainfo';
var gridInstance_recherche = null;
var tel1, tel2;
var currentData = [];
var filteredData = [];
var currentPage = 1;
var itemsPerPage = 10; // peut être redéfini via options

// Visibilité et métadonnées des colonnes
var visibleColumns = {};     // { column_key_normalized: boolean }
var columnDefinitions = {};  // { column_key_normalized: { key, label, width } }

// État de tri des colonnes
var sortState = {};          // { column_key_normalized: 'asc' | 'desc' | null }

// Paramètres et options de table sauvegardés
var tableOptions = {};       // Passées lors de createTable(...)

// Palettes de couleurs
const colorThemes = {
	default: {
		headerBg: 'bg-gray-50',
		buttonBg: 'bg-blue-600',
		buttonHover: 'hover:bg-blue-700',
		badgeBase: 'bg-blue-100 text-blue-800'
	},
	dark: {
		headerBg: 'bg-slate-800',
		buttonBg: 'bg-slate-600',
		buttonHover: 'hover:bg-slate-700',
		badgeBase: 'bg-slate-100 text-slate-800'
	},
	light: {
		headerBg: 'bg-sky-50',
		buttonBg: 'bg-sky-600',
		buttonHover: 'hover:bg-sky-700',
		badgeBase: 'bg-sky-100 text-sky-800'
	}
};

/* ====== Utilitaires ====== */
function escapeAttr(s) {
	if (s == null) return '';
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;');
}

/* ====== Configuration des colonnes ====== */
function parseColumnSpec(colSpec) {
	// Support for 'key as label' syntax
	const asIndex = colSpec.indexOf(' as ');
	if (asIndex !== -1) {
		const key = colSpec.substring(0, asIndex).trim();
		const label = colSpec.substring(asIndex + 4).trim();
		return { key, label };
	} else {
		return { key: colSpec, label: null };
	}
}

function generateColumnDefinitions(sqlData, options = {}) {
	if (!sqlData || sqlData.length === 0) {
		return { columns: {}, visibility: {} };
	}

	const firstRow = sqlData[0];
	const columns = {};
	const visibility = {};

	const excludedColumns = options.excludedColumns || [];
	const includedColumns = options.includedColumns || [];

	// Si includedColumns est spécifié, utiliser l'ordre de includedColumns
	if (includedColumns.length > 0) {
		includedColumns.forEach((colSpec) => {
			const { key: colName, label: customLabel } = parseColumnSpec(colSpec);

			// Chercher la colonne dans les données (insensible à la casse)
			const dataKey = Object.keys(firstRow).find(key =>
				key.toLowerCase() === colName.toLowerCase() ||
				key.toLowerCase().replace(/\s+/g, '_') === colName.toLowerCase().replace(/\s+/g, '_')
			);

			if (dataKey) {
				const columnKey = dataKey.toLowerCase().replace(/\s+/g, '_');
				const cleanLabel = customLabel || dataKey.replace(/[-_]/g, ' ').toUpperCase();
				columns[columnKey] = {
					key: dataKey,
					label: cleanLabel,
					width: 'w-32'
				};
				visibility[columnKey] = true;
			}
		});
	} else {
		// Sinon, utiliser l'ordre des données
		Object.keys(firstRow).forEach((key) => {
			const columnKey = key.toLowerCase().replace(/\s+/g, '_');

			// Décision : afficher ou non la colonne
			let shouldInclude = true;
			if (excludedColumns.length > 0) {
				shouldInclude = !excludedColumns.includes(key) && !excludedColumns.includes(columnKey);
			}

			if (shouldInclude) {
				const cleanLabel = key.replace(/[-_]/g, ' ').toUpperCase();
				columns[columnKey] = {
					key: key,
					label: cleanLabel,
					width: 'w-32'
				};
				visibility[columnKey] = true;
			}
		});
	}

	return { columns, visibility };
}

function initializeColumns(sqlData, options = {}) {
	const { columns, visibility } = generateColumnDefinitions(sqlData, options);
	columnDefinitions = columns;
	visibleColumns = visibility;

	// Afficher dans la console TOUTES les colonnes disponibles dans les données
	console.log('=== Toutes les colonnes disponibles dans les données ===');
	if (!sqlData || sqlData.length === 0) {
		console.log('Aucune donnée disponible');
		return;
	}

	const firstRow = sqlData[0];
	const allColumns = Object.keys(firstRow);
	console.log('Liste des colonnes:', allColumns);
	console.log('Utilisez ces clés dans includedColumns: [' + allColumns.map(key => `'${key}'`).join(', ') + ']');
	console.log('===========================================');
}

/* ====== Rendu de la coquille de base du tableau ====== */
async function afficheRechercheTableau(options = {}) {
	if (!options.containerId) {
		console.error('Erreur: containerId est obligatoire pour créer la table');
		return;
	}

	// sauvegarder les options globalement
	tableOptions = options;

	const container = $('#' + options.containerId);
	if (container.length > 0) {
		container.append(`
      <div class="bg-white rounded-lg shadow-sm border border-gray-200 w-full mx-auto">
        <!-- Header -->
        <div class="px-4 py-4 border-b border-gray-200 ${getCurrentPalette(options).headerBg}">
          <div class="flex items-center justify-between">
            ${options.enableSearch === true
				? `
              <div class="flex-1 max-w-md mr-4">
                <div class="relative">
                  <input type="text" id="global_search" placeholder="Rechercher dans tous les champs affichés ..." class="pl-8 pr-3 py-1.5 border border-gray-300 rounded-md text-sm w-full transition-colors duration-150 ease-in-out focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:ring-opacity-10">
                  <svg class="absolute left-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                  </svg>
                </div>
              </div>
            `
				: ''
			}

            ${options.enableColumnToggle !== false
				? `
              <div class="relative">
                <button id="columns_toggle" class="inline-flex items-center px-3 py-1.5 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" ${options.enableTooltip === true ? 'title="Afficher/masquer les colonnes"' : ''
				}>
                  <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                  </svg>
                  Colonnes
                  <svg class="w-4 h-4 ml-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                </button>

                <div id="columns_dropdown" class="hidden absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg border border-gray-200 z-50">
                  <div class="py-2">
                    <div id="column_dropdown_title" class="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wider border-b border-gray-100">
                      Colonnes affichées
                    </div>
                    <div id="column_checkboxes" class="py-1"></div>
                  </div>
                </div>
              </div>
            `
				: ''
			}
          </div>
        </div>

        <!-- Filters -->
        <div id="filters_container" class="px-4 py-4 bg-gray-50 border-b border-gray-200">
          <div id="filters_grid" class="grid gap-3"></div>
        </div>

        <!-- Results summary -->
        <div class="px-3 py-3 bg-gray-50 border-b border-gray-200">
          <div class="flex items-center justify-between">
            <span id="results_count" class="text-sm text-gray-600">0 résultats sur 0</span>
            <span class="text-sm text-blue-600">Affichage de 0 à 0 sur 0 résultats</span>
          </div>
        </div>

        <!-- Loading -->
        <div id="loading-spinner" class="hidden px-4 py-12">
          <div class="flex justify-center items-center">
            <div class="animate-spin rounded-lg h-8 w-8 border-b-2 border-blue-500"></div>
          </div>
        </div>

        <!-- Table -->
        <div id="table_container" class="overflow-x-auto" style="scrollbar-width:thin;scrollbar-color:#cbd5e0 #f7fafc;">
          <style>
            #table_container::-webkit-scrollbar{height:6px;}
            #table_container::-webkit-scrollbar-track{background:#f7fafc;border-radius:3px;}
            #table_container::-webkit-scrollbar-thumb{background:#cbd5e0;border-radius:3px;}
            #table_container::-webkit-scrollbar-thumb:hover{background:#a0aec0;}
          </style>
          <table style="table-layout: fixed; min-width: ${options.includedColumns ? options.includedColumns.length * 100 : 800}px;">
            <thead id="table_head" class="bg-gray-50"></thead>
            <tbody id="table_body" class="bg-white divide-y divide-gray-200"></tbody>
          </table>
        </div>

        <!-- Pagination -->
        <div class="px-4 py-4 bg-gray-50 border-t border-gray-200">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-4">
              ${options.enablePageSizeSelector !== false
				? `
              <div class="flex items-center space-x-2">
                <label for="page_size_selector" class="text-sm text-gray-700">Éléments par page:</label>
                <div class="relative">
                  <select id="page_size_selector" class="text-sm border border-gray-300 rounded px-2 py-1 pr-6 focus:outline-none focus:ring-1 focus:ring-blue-500 appearance-none">
                    ${(() => {
					const baseOptions = [5, 10, 20, 50, 100];
					if (!baseOptions.includes(itemsPerPage)) {
						baseOptions.push(itemsPerPage);
					}
					return baseOptions.sort((a, b) => a - b).map(size =>
						`<option value="${size}" ${itemsPerPage === size ? 'selected' : ''}>${size}</option>`
					).join('');
				})()}
                  </select>
                  <svg class="absolute right-1 top-1/2 transform -translate-y-1/2 w-3 h-3 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                </div>
              </div>
              `
				: ''
			}
              <div class="text-sm text-gray-700">
                Page <span id="current_page">1</span> sur <span id="total_pages">1</span>
              </div>
            </div>
            <div class="flex space-x-2">
              <button id="prev_page" class="inline-flex items-center px-2 py-1 text-xs font-medium text-gray-500 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out" ${options.enableTooltip === true ? 'title="Page précédente"' : ''
			}>
                <svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path>
                </svg>
                Précédent
              </button>
              <div id="page_numbers" class="flex space-x-1"></div>
              <button id="next_page" class="inline-flex items-center px-2 py-1 text-xs font-medium text-gray-500 bg-white border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition duration-150 ease-in-out" ${options.enableTooltip === true ? 'title="Page suivante"' : ''
			}>
                Suivant
                <svg class="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Action -->
        ${options.enableActionButton !== false
				? `
          <div class="px-4 py-4 border-t border-gray-200">
            <button id="btn_fiche" class="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white ${getCurrentPalette(options).buttonBg} border border-transparent rounded-md ${getCurrentPalette(options).buttonHover} focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-400 transition duration-150 ease-in-out" ${options.enableTooltip === true ? 'title="Voir les détails de la fiche sélectionnée"' : ''
				} disabled>
              <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>
              </svg>
              Voir la fiche
            </button>
          </div>
        `
				: ''
			}
      </div>
    `);
	}

	// Attacher les gestionnaires
	initializeTableEventListeners();

	// Les filtres/colonnes seront construits après initializeColumns(...)
	if (Object.keys(columnDefinitions).length > 0) {
		generateDynamicFilters(options);
	}
	if (options.enableColumnToggle !== false && Object.keys(columnDefinitions).length > 0) {
		initializeColumnDropdown();
	}

	// Affichage/masquage du conteneur de filtres
	if (options.enableFilters === false) {
		$('#filters_container').hide();
	} else {
		$('#filters_container').show();
	}
}

/* ====== Génération de filtres par colonnes ====== */
function generateDynamicFilters(options = {}) {
	const filtersGrid = $('#filters_grid');
	if (filtersGrid.length === 0) return;

	filtersGrid.empty();

	const columnCount = Object.keys(columnDefinitions).length;
	let gridCols = 'grid-cols-2 md:grid-cols-4 lg:grid-cols-8';
	if (columnCount <= 4) gridCols = 'grid-cols-2 md:grid-cols-4';
	else if (columnCount <= 6) gridCols = 'grid-cols-2 md:grid-cols-4 lg:grid-cols-6';

	filtersGrid.removeClass().addClass('grid gap-3 ' + gridCols);

	// Trier les colonnes pour que INDICE soit toujours en première position dans les filtres
	const sortedColumnKeys = Object.keys(columnDefinitions).sort((a, b) => {
		const aIsIndice = a.toLowerCase().includes('indice');
		const bIsIndice = b.toLowerCase().includes('indice');
		if (aIsIndice && !bIsIndice) return -1;
		if (!aIsIndice && bIsIndice) return 1;
		return 0; // Conserver l'ordre relatif pour les autres colonnes
	});

	sortedColumnKeys.forEach((columnKey) => {
		const column = columnDefinitions[columnKey];
		const filterId = `filter_${columnKey}`;
		const tooltip =
			options.enableTooltip === true ? ` title="Filtrer par ${column.label.toLowerCase()}"` : '';

		const filterHtml = `
		    <div class="relative">
		      <input type="text" id="${filterId}" placeholder="${column.label.toLowerCase()}" class="pl-8 pr-3 py-1.5 border border-gray-300 rounded-md text-sm w-full transition-colors duration-150 ease-in-out focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:ring-opacity-10"${tooltip}>
		      <svg class="absolute left-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
		        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
		      </svg>
		    </div>
		  `;
		filtersGrid.append(filterHtml);
	});

	bindFilterEvents();
}

/* ====== Initialisation des données ====== */
function initTableRecherche(data = '', options = {}) {
	let processedData;

	if (data && data.length > 0) {
		if (data['INDICE']) {
			processedData = [data];
		} else {
			processedData = data.slice(0, 20000);
		}

		initializeColumns(processedData, options);
		generateDynamicFilters(options);
		if (options.enableColumnToggle !== false) {
			initializeColumnDropdown();
		}
	} else {
		loadSampleData(); // créera les données d'exemple et continuera
		return;
	}

	currentData = processedData;
	filteredData = [...currentData];

	renderTable(options);
	updatePagination();
	updateResultsCount();
	afficheTableauChargement(false);

	if ($('#btn_fiche').length > 0) {
		$('#btn_fiche').prop('disabled', true);
	}
}

/* ====== Logique métier ====== */
function verifDateFicheSelectionnee(dateFiche) {
	let date = moment(dateFiche);
	let today = moment();
	let dateFiche30 = moment(date).add(30, 'days');
	if (dateFiche30.isBefore(today)) {
		if ($('#btn_fiche').length > 0) {
			$('#btn_fiche').prop('disabled', true);
		}
		showNotification(
			'warning',
			`La fiche sélectionnée a été injectée il y a plus de 30 jours, date d'injection : ${date.format('DD/MM/YYYY')} `,
			'Fiche client'
		);
	}
}

function afficheTableauChargement(valid) {
	if (valid) {
		$('#table_container').hide();
		$('#loading-spinner').removeClass('hidden');
	} else {
		$('#table_container').show();
		$('#loading-spinner').addClass('hidden');
	}
}

/* ====== Écouteurs d'interface ====== */
function initializeTableEventListeners() {
	bindFilterEvents();

	if ($('#global_search').length > 0) {
		$('#global_search').on('input', function () {
			applyGlobalSearch();
		});
	}

	if ($('#select_all').length > 0) {
		$('#select_all').on('change', function () {
			const isChecked = $(this).is(':checked');
			$('.row-checkbox').prop('checked', isChecked);
			updateSelectedRows();
		});
	}

	$('#prev_page').on('click', function () {
		if (currentPage > 1) {
			currentPage--;
			renderTable(tableOptions);
			updatePagination();
			updateResultsCount();
		}
	});

	$('#next_page').on('click', function () {
		const totalPages = Math.ceil(filteredData.length / itemsPerPage);
		if (currentPage < totalPages) {
			currentPage++;
			renderTable(tableOptions);
			updatePagination();
			updateResultsCount();
		}
	});

	if ($('#page_size_selector').length > 0) {
		$('#page_size_selector').on('change', function () {
			itemsPerPage = parseInt($(this).val(), 10);
			currentPage = 1;
			renderTable(tableOptions);
			updatePagination();
			updateResultsCount();
		});
	}

	if ($('#columns_toggle').length > 0) {
		$('#columns_toggle').on('click', function (e) {
			e.stopPropagation();
			$('#columns_dropdown').toggleClass('hidden');
		});

		$(document).on('click', function (e) {
			if (!$(e.target).closest('#columns_toggle, #columns_dropdown').length) {
				$('#columns_dropdown').addClass('hidden');
			}
		});
	}

	if ($('#btn_fiche').length > 0) {
		$('#btn_fiche').on('click', function () {
			$('#btn_fiche').prop('disabled', true);

			if (GLOBAL.contextCampaign == 'Entrant') {
				GLOBAL.valueRechercheEntrant = $('#search_value').val();
				GLOBAL.typeRechercheEntrant = $('#search_field_entrant').val();
				showPage('Index');
			} else {
				GetAgentLink().SearchModeSelect(GLOBAL.indiceFiche, true, tel1);
			}
		});
	}
}

function bindFilterEvents() {
	$('#filters_grid').off('input', 'input[type="text"]');
	if ($('#filters_grid').length > 0) {
		$('#filters_grid').on('input', 'input[type="text"]', function () {
			applyFilters();
		});
	}
}

/* ====== Dropdown des colonnes ====== */
function initializeColumnDropdown() {
	const checkboxContainer = $('#column_checkboxes');
	if (checkboxContainer.length === 0) return;

	checkboxContainer.empty();

	// Trier les colonnes pour que INDICE soit toujours en première position dans le dropdown
	const sortedColumnKeys = Object.keys(columnDefinitions).sort((a, b) => {
		const aIsIndice = a.toLowerCase().includes('indice');
		const bIsIndice = b.toLowerCase().includes('indice');
		if (aIsIndice && !bIsIndice) return -1;
		if (!aIsIndice && bIsIndice) return 1;
		return 0; // Conserver l'ordre relatif pour les autres colonnes
	});

	sortedColumnKeys.forEach((columnKey) => {
		const column = columnDefinitions[columnKey];
		const isChecked = visibleColumns[columnKey] !== false ? 'checked' : '';

		const checkboxHtml = `
	     <label class="flex items-center px-4 py-2 hover:bg-gray-50 cursor-pointer transition-colors duration-200">
	       <input type="checkbox" ${isChecked} class="rounded border-gray-300 text-blue-600 focus:ring-blue-500 focus:ring-2 focus:border-blue-500 mr-3 transition-all duration-200 hover:border-blue-400 hover:shadow-sm" data-column="${columnKey}">
	       <span class="text-sm text-gray-700 hover:text-gray-900 transition-colors duration-200">${column.label}</span>
	     </label>
	   `;
		checkboxContainer.append(checkboxHtml);
	});

	updateColumnDropdownTitle();

	checkboxContainer.off('change', 'input[type="checkbox"]');
	checkboxContainer.on('change', 'input[type="checkbox"]', function () {
		const columnKey = $(this).data('column');
		visibleColumns[columnKey] = $(this).is(':checked');
		updateColumnDropdownTitle();
		renderTable(tableOptions);
	});
}

function updateColumnDropdownTitle() {
	const titleElement = $('#column_dropdown_title');
	if (titleElement.length === 0) return;

	const allChecked = Object.keys(columnDefinitions).every(
		(columnKey) => visibleColumns[columnKey] !== false
	);

	if (allChecked) {
		titleElement.html('Colonnes affichées');
		titleElement.removeClass('cursor-pointer hover:text-blue-600');
		titleElement.off('click');
	} else {
		titleElement.html('<button class="w-full text-left hover:text-blue-600">AFFICHER TOUTES LES COLONNES</button>');
		titleElement.addClass('cursor-pointer');
		titleElement.off('click').on('click', function (e) {
			e.stopPropagation();
			Object.keys(columnDefinitions).forEach((columnKey) => {
				visibleColumns[columnKey] = true;
			});
			$('#column_checkboxes input[type="checkbox"]').prop('checked', true);
			updateColumnDropdownTitle();
			renderTable(tableOptions);
		});
	}
}

/* ====== Filtrage et recherche ====== */
function applyFilters() {
	const filters = {};

	Object.keys(columnDefinitions).forEach((columnKey) => {
		const filterId = `#filter_${columnKey}`;
		const $el = $(filterId);
		if ($el.length > 0) {
			const v = $el.val();
			if (v) filters[columnKey] = v.toLowerCase();
		}
	});

	filteredData = currentData.filter((row) => {
		const filtersMatch = Object.keys(filters).every((columnKey) => {
			const column = columnDefinitions[columnKey];
			const filterValue = filters[columnKey];
			const rowValue = row[column.key];

			if (!rowValue) return false;

			if (column.key.toLowerCase().includes('tel')) {
				return rowValue.toString().replace(/\s/g, '').toLowerCase()
					.includes(filterValue.replace(/\s/g, ''));
			}
			return rowValue.toString().toLowerCase().includes(filterValue);
		});

		const globalSearchValue = $('#global_search').val();
		if (globalSearchValue) {
			const gsv = globalSearchValue.toLowerCase();
			const globalSearchMatch = Object.keys(columnDefinitions).some((columnKey) => {
				if (!visibleColumns[columnKey]) return false;
				const column = columnDefinitions[columnKey];
				const rowValue = row[column.key];
				if (!rowValue) return false;

				if (column.key.toLowerCase().includes('tel')) {
					return rowValue.toString().replace(/\s/g, '').toLowerCase()
						.includes(gsv.replace(/\s/g, ''));
				}
				return rowValue.toString().toLowerCase().includes(gsv);
			});

			return filtersMatch && globalSearchMatch;
		}

		return filtersMatch;
	});

	currentPage = 1;

	// Réappliquer le tri si actif
	const activeSortColumn = Object.keys(sortState).find(key => sortState[key]);
	if (activeSortColumn && sortState[activeSortColumn]) {
		const column = columnDefinitions[activeSortColumn];
		if (column) {
			filteredData = sortData(filteredData, column.key, sortState[activeSortColumn]);
		}
	}

	renderTable(tableOptions);
	updatePagination();
	updateResultsCount();
}

function applyGlobalSearch() {
	const searchValue = $('#global_search').length > 0 ? $('#global_search').val().toLowerCase() : '';
	const filters = {};

	Object.keys(columnDefinitions).forEach((columnKey) => {
		const filterId = `#filter_${columnKey}`;
		const $el = $(filterId);
		if ($el.length > 0) {
			const v = $el.val();
			if (v) filters[columnKey] = v.toLowerCase();
		}
	});

	filteredData = currentData.filter((row) => {
		const filtersMatch = Object.keys(filters).every((columnKey) => {
			const column = columnDefinitions[columnKey];
			const filterValue = filters[columnKey];
			const rowValue = row[column.key];

			if (!rowValue) return false;

			if (column.key.toLowerCase().includes('tel')) {
				return rowValue.toString().replace(/\s/g, '').toLowerCase()
					.includes(filterValue.replace(/\s/g, ''));
			}
			return rowValue.toString().toLowerCase().includes(filterValue);
		});

		if (searchValue) {
			const globalSearchMatch = Object.keys(columnDefinitions).some((columnKey) => {
				if (!visibleColumns[columnKey]) return false;
				const column = columnDefinitions[columnKey];
				const rowValue = row[column.key];
				if (!rowValue) return false;

				if (column.key.toLowerCase().includes('tel')) {
					return rowValue.toString().replace(/\s/g, '').toLowerCase()
						.includes(searchValue.replace(/\s/g, ''));
				}
				return rowValue.toString().toLowerCase().includes(searchValue);
			});

			return filtersMatch && globalSearchMatch;
		}

		return filtersMatch;
	});

	currentPage = 1;

	// Réappliquer le tri si actif
	const activeSortColumn = Object.keys(sortState).find(key => sortState[key]);
	if (activeSortColumn && sortState[activeSortColumn]) {
		const column = columnDefinitions[activeSortColumn];
		if (column) {
			filteredData = sortData(filteredData, column.key, sortState[activeSortColumn]);
		}
	}

	renderTable(tableOptions);
	updatePagination();
	updateResultsCount();
}

/* ====== Rendu du tableau ====== */
function renderTable(options) {
	options = options || {};
	const startIndex = (currentPage - 1) * itemsPerPage;
	const endIndex = startIndex + itemsPerPage;
	const pageData = filteredData.slice(startIndex, endIndex);

	const thead = $('#table_head');
	if (thead.length > 0) thead.empty();

	const visibleCount = Object.keys(columnDefinitions).filter(key => visibleColumns[key]).length;
	const widthPercent = visibleCount > 0 ? (100 / visibleCount) + '%' : 'auto';

	// Trier les colonnes pour que INDICE soit toujours en première position
	const sortedColumnKeys = Object.keys(columnDefinitions).sort((a, b) => {
		const aIsIndice = a.toLowerCase().includes('indice');
		const bIsIndice = b.toLowerCase().includes('indice');
		if (aIsIndice && !bIsIndice) return -1;
		if (!aIsIndice && bIsIndice) return 1;
		return 0; // Conserver l'ordre relatif pour les autres colonnes
	});

	let headerHtml = '<tr>';
	sortedColumnKeys.forEach((columnKey) => {
		if (visibleColumns[columnKey]) {
			const column = columnDefinitions[columnKey];
			const sortDirection = sortState[columnKey];
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
			     <th class="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider min-w-[100px] ${cursorClass}" style="width: ${widthPercent};" data-column="${columnKey}">
			       <div class="flex items-center justify-between">
			         <span class="column-title">${column.label}</span>
			         ${sortIcon}
			       </div>
			     </th>
			   `;
		}
	});
	headerHtml += '</tr>';
	if (thead.length > 0) thead.append(headerHtml);

	const tbody = $('#table_body');
	if (tbody.length > 0) tbody.empty();

	pageData.forEach((row, index) => {
		const indiceKey = Object.keys(row).find((k) => k.toLowerCase().includes('indice')) || Object.keys(row)[0];
		const indiceValue = row[indiceKey];
		const isSelected = GLOBAL.indiceFiche && GLOBAL.indiceFiche == indiceValue;

		let rowHtml = `<tr class="cursor-pointer table-row border-b border-gray-100 ${isSelected ? 'bg-blue-50' : 'hover:bg-blue-50'}" data-index="${startIndex + index}" data-indice="${indiceValue}">`;

		sortedColumnKeys.forEach((columnKey) => {
			if (!visibleColumns[columnKey]) return;

			const column = columnDefinitions[columnKey];
			let cellValue = row[column.key] || '';

			if (column.key.toLowerCase().includes('tel') && cellValue) {
				cellValue = cellValue.toString().replace(/\s/g, '');
			}

			// Formater les dates
			if ((column.key.toLowerCase().includes('date') || column.key.toLowerCase().includes('appel')) && cellValue) {
				const date = moment(cellValue);
				if (date.isValid()) {
					cellValue = date.format('DD/MM/YYYY HH:mm');
				}
			}

			if (tableOptions.badgeColumns.some(badgeCol => column.key.toLowerCase().includes(badgeCol.toLowerCase()) || badgeCol.toLowerCase().includes(column.key.toLowerCase()))) {
				const statusBadge = getStatusBadge(cellValue);
				rowHtml += `<td class="px-3 py-3 whitespace-nowrap">${statusBadge}</td>`;
			} else {
				const fontWeight = column.key.toLowerCase().includes('indice') ? 'font-medium' : '';

				const isLongText = cellValue && cellValue.length > 30;

				const truncateClass = isLongText ? 'truncate max-w-xs' : '';
				const tooltipAttr =
					isLongText && options.enableTooltip === true
						? ` data-tooltip="${escapeAttr(cellValue)}"`
						: '';

				rowHtml += `<td class="px-3 py-3 whitespace-nowrap text-sm text-gray-900 ${fontWeight} ${truncateClass}"${tooltipAttr}>${cellValue}</td>`;
			}
		});

		rowHtml += '</tr>';
		if (tbody.length > 0) tbody.append(rowHtml);
	});

	// clics sur les lignes
	$('.table-row').off('click').on('click', function () {
		$('.table-row').removeClass('bg-blue-50').addClass('hover:bg-gray-50');
		$(this).removeClass('hover:bg-gray-50').addClass('bg-blue-50');

		const indice = $(this).data('indice');
		GLOBAL.indiceFiche = indice;
		updateSelectedRows();
	});

	// mettre à jour le dropdown des colonnes (si activé)
	if (options.enableColumnToggle !== false && Object.keys(columnDefinitions).length > 0) {
		initializeColumnDropdown();
	}

	// Attacher les gestionnaires de tri
	if (options.orderByColumns) {
		// Gestionnaire pour l'icône de tri
		$('#table_head')
			.off('click', 'th[data-column]')
			.on('click', 'th[data-column]', function (e) {
				e.preventDefault();

				const columnKey = $(this).data('column');
				const column = columnDefinitions[columnKey];
				if (!column) return;

				// Cycle: null -> asc -> desc -> null
				const currentSort = sortState[columnKey];
				let nextSort = currentSort === 'asc' ? 'desc' : currentSort === 'desc' ? null : 'asc';

				// Réinitialiser le tri des autres colonnes
				Object.keys(sortState).forEach(k => { sortState[k] = null; });
				sortState[columnKey] = nextSort;

				if (nextSort) {
					filteredData = sortData(filteredData, column.key, nextSort);
				} else {
					// Retour aux données originales + réapplication des filtres/recherche
					filteredData = [...currentData];
					applyFilters(); // redessinera automatiquement et gardera la page 1
					return;        // pour éviter de redessiner deux fois
				}

				currentPage = 1;
				renderTable(tableOptions);
				updatePagination();
				updateResultsCount();
			});
	}
}

/* ====== Badge de statut ====== */
function getStatusBadge(status) {
	if (!status) {
		return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-800">${status || 'N/A'}</span>`;
	}
	const s = String(status).toLowerCase();
	if (s.includes('rappel') || s.includes('rappelé') || s.includes('à rappeler')) {
		return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-yellow-100 text-yellow-800">${status}</span>`;
	}
	if (s.includes('rdv') || s.includes('rendez-vous')) {
		return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-blue-100 text-blue-800">${status}</span>`;
	}
	if (s.includes('relance')) {
		return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-purple-100 text-purple-800">${status}</span>`;
	}
	if (s.includes('absent') || s.includes('non répondu')) {
		return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-red-100 text-red-800">${status}</span>`;
	}
	if (s.includes('refus') || s.includes('négatif')) {
		return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-orange-100 text-orange-800">${status}</span>`;
	}
	if (s.includes('test') || s.includes('essai')) {
		return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-800">${status}</span>`;
	}
	if (s.includes('positif') || s.includes('accepté') || s.includes('validé')) {
		return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-green-100 text-green-800">${status}</span>`;
	}
	if (s.includes('en cours') || s.includes('traitement')) {
		return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-cyan-100 text-cyan-800">${status}</span>`;
	}
	if (s.includes('nouveau') || s.includes('fresh')) {
		return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-indigo-100 text-indigo-800">${status}</span>`;
	}
	if (s.includes('urgent') || s.includes('priorité')) {
		return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-pink-100 text-pink-800">${status}</span>`;
	}
	return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-gray-100 text-gray-800">${status}</span>`;
}

/* ====== Sélection de ligne / pagination / compteurs ====== */
function updateSelectedRows() {
	const hasSelection = GLOBAL.indiceFiche !== undefined && GLOBAL.indiceFiche !== null;

	if ($('#btn_fiche').length > 0) {
		$('#btn_fiche').prop('disabled', !hasSelection);
	}

	if (hasSelection) {
		const indiceKey =
			Object.keys(currentData[0] || {}).find((k) => k.toLowerCase().includes('indice')) || 'Indice';

		const selectedData = currentData.find((row) => row[indiceKey] == GLOBAL.indiceFiche);
		if (selectedData) {
			const telKey = Object.keys(selectedData).find(
				(k) => k.toLowerCase().includes('tel') && selectedData[k]
			);
			if (telKey) {
				tel1 = selectedData[telKey];
			}

			if (GLOBAL.contextCampaign == 'Entrant') {
				const dateKey = Object.keys(selectedData).find(
					(k) => k.toLowerCase().includes('date') || k.toLowerCase().includes('day')
				);
				if (dateKey && selectedData[dateKey]) {
					verifDateFicheSelectionnee(selectedData[dateKey]);
				}
			}
		}
	}
}

function updatePagination() {
	const totalPages = Math.max(1, Math.ceil(filteredData.length / itemsPerPage));

	$('#current_page').text(currentPage);
	$('#total_pages').text(totalPages);

	$('#prev_page').prop('disabled', currentPage === 1);
	$('#next_page').prop('disabled', currentPage === totalPages);

	const pageNumbers = $('#page_numbers');
	pageNumbers.empty();

	const addPageButton = (pageNum, isActive = false, isDisabled = false, isDots = false) => {
		if (isDots) {
			pageNumbers.append(`<span class="px-2 py-1 text-xs font-medium text-gray-400 select-none">...</span>`);
		} else if (isActive) {
			pageNumbers.append(
				`<button class="px-2 py-1 text-xs font-medium text-white ${getCurrentPalette(tableOptions).buttonBg} border border-blue-600 rounded select-none">${pageNum}</button>`
			);
		} else if (isDisabled) {
			pageNumbers.append(
				`<button class="px-2 py-1 text-xs font-medium text-gray-300 bg-gray-50 border border-gray-200 rounded cursor-not-allowed select-none" disabled>${pageNum}</button>`
			);
		} else {
			pageNumbers.append(
				`<button class="px-2 py-1 text-xs font-medium text-gray-500 bg-white border border-gray-300 rounded hover:bg-gray-50 hover:border-gray-400 page-btn transition duration-150 ease-in-out" data-page="${pageNum}">${pageNum}</button>`
			);
		}
	};

	if (totalPages >= 1) addPageButton(1, currentPage === 1);

	const delta = 1;
	const rangeStart = Math.max(2, currentPage - delta);
	const rangeEnd = Math.min(totalPages - 1, currentPage + delta);

	if (rangeStart > 2) addPageButton(null, false, false, true);

	for (let i = rangeStart; i <= rangeEnd; i++) {
		if (i !== 1 && i !== totalPages) addPageButton(i, i === currentPage);
	}

	if (rangeEnd < totalPages - 1) addPageButton(null, false, false, true);

	if (totalPages > 1) addPageButton(totalPages, currentPage === totalPages);

	$('.page-btn').off('click').on('click', function () {
		currentPage = parseInt($(this).data('page'), 10);
		renderTable(tableOptions);
		updatePagination();
		updateResultsCount();
	});
}

function updateResultsCount() {
	const total = currentData.length;
	const filtered = filteredData.length;
	const startIndex = filtered === 0 ? 0 : (currentPage - 1) * itemsPerPage + 1;
	const endIndex = filtered === 0 ? 0 : Math.min(startIndex + itemsPerPage - 1, filtered);

	$('#results_count').text(`${filtered} résultats sur ${total}`);
	$('.text-blue-600').text(
		filtered > 0 ? `Affichage de ${startIndex} à ${endIndex} sur ${filtered} résultats` : 'Aucun résultat'
	);
}

/* ====== Données de démonstration ====== */
function loadSampleData() {
	currentPage = 1;
	const sampleSize = Math.max(50, itemsPerPage * 10);
	const baseData = {
		"Agent": "",
		"Commentaire": "",
		"Date appel": "",
		"Dpt": "",
		"Détail": "",
		"Indice": "",
		"Nom prospect": "",
		"Nom société": "",
		"PRIORITE": "",
		"Relance": "",
		"SIREN": "",
		"Statut": "",
		"Tel fixe": "",
		"Tel port": "",
		"contact_adresse": "",
		"contact_cp": "",
		"contact_fonction_prospect": "",
		"contact_prenom_prospect": "",
		"contact_ville": "",
		"date engagement": "",
		"montant": ""
	};

	const agents = ["Rachida MESSAOUDI", "Marie DUPONT", "Pierre BERNARD", "Sophie THOMAS", "Luc PETIT", "Anne ROBERT", "Paul RICHARD", "Julie MOREAU"];
	const statuts = ["Refus argumenté", "Rdv", "Rappel", "Relance", "Test", "Absent"];
	const villes = ["dijon", "paris", "lyon", "marseille", "toulouse", "nice", "nantes", "strasbourg"];
	const societes = ["", "SARL MARTIN", "EURL BERNARD", "SAS ROBERT", "SASU DUPONT", "SA THOMAS"];

	const sampleData = [];
	for (let i = 0; i < sampleSize; i++) {
		const data = { ...baseData };
		data.Indice = 217570 + i;
		data.Agent = agents[i % agents.length];
		data.Statut = statuts[i % statuts.length];
		data.contact_ville = villes[i % villes.length];
		data["Nom société"] = societes[i % societes.length];
		data["Date appel"] = `2024-06-${String(25 + (i % 5)).padStart(2, '0')} ${String(9 + (i % 12)).padStart(2, '0')}:${String(15 + (i % 45)).padStart(2, '0')}`;
		data.PRIORITE = (i % 5) - 1;
		data.Commentaire =
			i % 3 === 0
				? "Client intéressé ".repeat(22).trim()
				: i % 3 === 1
					? "À rappeler"
					: "";
		data["Tel port"] =
			i % 2 === 0
				? `06 ${String(10 + (i % 89)).padStart(2, '0')} ${String(10 + (i % 89)).padStart(2, '0')} ${String(10 + (i % 89)).padStart(2, '0')} ${String(10 + (i % 89)).padStart(2, '0')}`
				: "";
		data.montant = i % 4 === 0 ? String((i + 1) * 1000) : "";

		sampleData.push(data);
	}

	// Initialiser les colonnes basées sur les données de démonstration et les options globales
	initializeColumns(sampleData, tableOptions);

	// Mettre à jour les filtres/basculeur de colonnes
	generateDynamicFilters(tableOptions);
	if (tableOptions.enableColumnToggle !== false) {
		initializeColumnDropdown();
	}

	currentData = sampleData;
	filteredData = [...currentData];

	renderTable(tableOptions);
	updatePagination();
	updateResultsCount();
	afficheTableauChargement(false);

	if ($('#btn_fiche').length > 0) {
		$('#btn_fiche').prop('disabled', true);
	}
}

/* ====== Chargement de données externes ====== */
function loadDataFromJSON(jsonData) {
	if (!Array.isArray(jsonData)) {
		console.error('Les données doivent être un tableau');
		return;
	}

	currentData = jsonData;
	filteredData = [...currentData];
	currentPage = 1;

	initializeColumns(currentData, tableOptions);
	generateDynamicFilters(tableOptions);
	if (tableOptions.enableColumnToggle !== false) {
		initializeColumnDropdown();
	}

	renderTable(tableOptions);
	updatePagination();
	updateResultsCount();
	afficheTableauChargement(false);

	if ($('#btn_fiche').length > 0) {
		$('#btn_fiche').prop('disabled', true);
	}
}

/* ====== Utilitaires pour couleurs ====== */
function generateHoverClass(bgClass) {
	// Exemple: bg-blue-600 -> hover:bg-blue-700
	const colorMatch = bgClass.match(/bg-(\w+)-(\d+)/);
	if (colorMatch) {
		const color = colorMatch[1];
		const shade = parseInt(colorMatch[2]);
		const hoverShade = Math.min(900, shade + 100); // Augmenter la nuance pour le survol
		return `hover:bg-${color}-${hoverShade}`;
	}
	return 'hover:bg-gray-700'; // Valeur par défaut
}

function getCurrentPalette(options) {
	if (options.customPalette) {
		return options.customPalette;
	}
	return colorThemes[options.theme] || colorThemes.default;
}

/* ====== Tri des données ====== */
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


/* ====== API publique ====== */
function createTable(options = {}) {
	options.theme = options.theme || 'default';
	options.badgeColumns = options.badgeColumns || ['Statut']; // Colonnes où appliquer la logique des badges
	options.orderByColumns = options.orderByColumns !== false; // Activer le tri par colonnes par défaut
	options.enablePageSizeSelector = options.enablePageSizeSelector !== false; // Activer le sélecteur de taille de page par défaut
	currentPage = 1;
	itemsPerPage = options.itemsPerPageCount || 10;

	// Gérer la palette de couleurs personnalisée
	if (options.colorPalette && Array.isArray(options.colorPalette) && options.colorPalette.length === 2) {
		options.customPalette = {
			headerBg: options.colorPalette[0],
			buttonBg: options.colorPalette[1],
			buttonHover: generateHoverClass(options.colorPalette[1])
		};
	}

	afficheRechercheTableau(options);
	initTableRecherche(options.data, options);

	return {
		updateData: function (newData) {
			initTableRecherche(newData, tableOptions);
		},
		getCurrentPage: function () {
			return currentPage;
		},
		getFilteredData: function () {
			return filteredData;
		}
	};
}


// Initialisation des tooltips sur Floating UI
function initializeFloatingUITooltips() {
	const { computePosition, autoUpdate, offset, flip, shift, hide: hideMw, arrow } = window.FloatingUIDOM;

	const ATTR = 'data-tooltip';
	const ATTR_PLACEMENT = 'data-placement';

	let cleanup = null;
	let currentRef = null;

	// élément DOM unique du tooltip
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

		// remplir le texte
		tooltip.textContent = '';
		const span = document.createElement('span');
		span.textContent = content;
		tooltip.appendChild(span);
		tooltip.appendChild(arrowEl);
		tooltip.style.display = 'block';

		if (cleanup) cleanup();
		cleanup = autoUpdate(ref, tooltip, async () => {
			const placement = ref.getAttribute(ATTR_PLACEMENT) || 'top';

			const { x, y, placement: finalPlacement, middlewareData } = await computePosition(ref, tooltip, {
				strategy: 'fixed', // important pour les tableaux avec défilement
				placement,
				middleware: [
					offset(8),
					flip(),
					shift({ padding: 8 }),
					hideMw(),
					arrow({ element: arrowEl }),
				],
			});

			tooltip.style.left = `${x}px`;
			tooltip.style.top = `${y}px`;

			const isHidden = middlewareData.hide?.referenceHidden || middlewareData.hide?.escaped;
			tooltip.style.opacity = isHidden ? '0' : '1';
			tooltip.style.transform = isHidden ? 'translateY(4px)' : 'translateY(0)';

			// positionner la flèche
			const staticSide = { top: 'bottom', right: 'left', bottom: 'top', left: 'right' }[finalPlacement.split('-')[0]];
			Object.assign(arrowEl.style, { left: '', right: '', top: '', bottom: '' });
			arrowEl.style[staticSide] = `-6px`;

			const { x: ax = 0, y: ay = 0 } = middlewareData.arrow || {};
			if (finalPlacement.startsWith('top') || finalPlacement.startsWith('bottom')) {
				arrowEl.style.left = `${ax}px`;
				arrowEl.style.top = '';
				arrowEl.style.transform = 'translateX(-50%) rotate(45deg)';
			} else {
				arrowEl.style.top = `${ay}px`;
				arrowEl.style.left = '';
				arrowEl.style.transform = 'translateY(-50%) rotate(45deg)';
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

	// délégation d'événements — fonctionne aussi pour les lignes ajoutées dynamiquement
	document.addEventListener('mouseover', (e) => {
		const ref = e.target.closest(`[${ATTR}]`);
		if (!ref) return;
		if (currentRef === ref) return;
		currentRef = ref;
		show(ref);
	});

	document.addEventListener('mouseout', (e) => {
		if (!currentRef) return;
		const to = e.relatedTarget;
		if (to && (currentRef.contains(to) || tooltip.contains(to))) return;
		hideTooltip();
	});

	document.addEventListener('focusin', (e) => {
		const ref = e.target.closest(`[${ATTR}]`);
		if (ref) { currentRef = ref; show(ref); }
	});

	document.addEventListener('focusout', (e) => {
		const to = e.relatedTarget;
		if (to && (currentRef?.contains(to) || tooltip.contains(to))) return;
		hideTooltip();
	});

	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') hideTooltip();
	});
}

