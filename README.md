# 📊 Table SQL Dynamique

Tableau interactif avec génération automatique des colonnes à partir des données SQL.

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## Installation

```html
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js"></script>
<script src="m_recherche_tableau_tailwind.js"></script>
```

## Utilisation rapide

```javascript
// Avec données de démo
const table = createTable({
    containerId: 'my-table',
    data: null,
    enableActionButton: true
});

// Avec vos données SQL
const table = createTable({
    containerId: 'my-table',
    data: sqlData,
    enableActionButton: true
});
```

## Options principales

```javascript
const table = createTable({
    containerId: 'my-table-container', // OBLIGATOIRE - ID du conteneur HTML
    data: sqlData,                    // Données SQL ou null pour démo
    includedColumns: ['Indice', 'Agent', 'Statut'], // Colonnes à afficher
    excludedColumns: ['Commentaire'], // Colonnes à masquer
    enableSearch: true,              // Recherche globale
    enableColumnToggle: true,        // Bouton gestion colonnes
    enableTooltip: true,             // Infobulles
    enableActionButton: true,        // Bouton d'action
    enablePageSizeSelector: true,    // Sélecteur de taille de page (5, 10, 15, 20, 50, 100)
    itemsPerPageCount: 10            // Éléments par page (valeur par défaut)
});
```

## Gestion des colonnes

```javascript
// Inclure seulement certaines colonnes
includedColumns: ['Indice', 'Agent', 'Statut', 'Commentaire']

// Exclure certaines colonnes
excludedColumns: ['Commentaire', 'Dpt']

// Toutes les colonnes (par défaut)
```

**Note importante:** Pour afficher la colonne `INDICE`, vous devez l'inclure explicitement dans `includedColumns`. Elle sera automatiquement placée en première position dans la table.

## Format des données

```javascript
const sqlData = [
    {
        "Indice": 12345,
        "Agent": "Dubois Marie",
        "Statut": "Terminé",
        "Date appel": "2024-06-25 13:21:00"
    }
];
```

## API

```javascript
// Mise à jour des données
table.updateData(newData);

// État actuel
const page = table.getCurrentPage();
const data = table.getFilteredData();
```

## 📋 Exemples

### Tableau simple

```javascript
const table = createTable({
    containerId: 'my-table',
    data: sqlData,
    enableActionButton: true
});
```

### Avec colonnes spécifiques

```javascript
const table = createTable({
    containerId: 'contacts-table',
    data: sqlData,
    includedColumns: ['Indice', 'Agent', 'Statut', 'Commentaire'],
    enableSearch: true,
    enableColumnToggle: true
});
```

### Version mobile

```javascript
const table = createTable({
    containerId: 'mobile-table',
    data: sqlData,
    includedColumns: ['Indice', 'Agent'],
    itemsPerPageCount: 5
});
```

### Avec sélecteur de taille de page

```javascript
const table = createTable({
    containerId: 'advanced-table',
    data: sqlData,
    enablePageSizeSelector: true,    // Active le sélecteur de taille de page
    itemsPerPageCount: 15,           // Taille par défaut (sera dans les options)
    enableSearch: true,
    enableColumnToggle: true
});
```
