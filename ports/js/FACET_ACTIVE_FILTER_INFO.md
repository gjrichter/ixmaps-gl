# Facet Active Filter Information

## Overview

Each facet now automatically includes information about whether it's part of an active filter. This allows you to:
- Highlight active facets in the UI
- Show which filters are currently applied
- Easily remove or modify active filters
- Provide visual feedback to users

---

## Facet Properties

Every facet now has these additional properties:

### `isActive` (boolean)
Indicates if this facet is part of the current filter query.

### `activeFilter` (string | null)
The actual filter string applied to this facet (if active), or `null` if not active.

---

## Examples

### 1. **Inactive Facet**

```javascript
{
  id: "price",
  type: "numeric",
  min: 0,
  max: 1000,
  isActive: false,        // ← Not filtered
  activeFilter: null,     // ← No filter
  getFilter: (minVal, maxVal) => { ... }
}
```

### 2. **Active Numeric Facet**

```javascript
{
  id: "price",
  type: "numeric",
  min: 0,
  max: 1000,
  isActive: true,                         // ← Filtered!
  activeFilter: '"price" BETWEEN 100 AND 500',  // ← Current filter
  getFilter: (minVal, maxVal) => { ... }
}
```

### 3. **Active Textual Facet (Single Value)**

```javascript
{
  id: "category",
  type: "textual",
  values: ["Hotel", "B&B", "Apartment"],
  isActive: true,                    // ← Filtered!
  activeFilter: '"category" = "Hotel"',  // ← Current filter
  getFilter: (selectedValues) => { ... }
}
```

### 4. **Active Textual Facet (Multiple Values)**

```javascript
{
  id: "region",
  type: "textual",
  values: ["North", "South", "East", "West"],
  isActive: true,                              // ← Filtered!
  activeFilter: '"region" IN ("North","South")',  // ← Current filter
  getFilter: (selectedValues) => { ... }
}
```

---

## Usage in UI

### Highlight Active Facets

```javascript
const facets = ixmaps.data.getFacets(currentFilter, null, null, "theme");

for (const facet of facets) {
  const element = document.getElementById(`facet-${facet.id}`);
  
  if (facet.isActive) {
    // Highlight active facet
    element.classList.add('active-facet');
    
    // Show current filter
    element.title = `Active: ${facet.activeFilter}`;
  } else {
    element.classList.remove('active-facet');
  }
}
```

### Display Active Filters List

```javascript
const facets = ixmaps.data.getFacets(currentFilter, null, null, "theme");

// Get all active facets
const activeFacets = facets.filter(f => f.isActive);

// Display active filters
const filterList = document.getElementById('active-filters');
filterList.innerHTML = '';

for (const facet of activeFacets) {
  const item = document.createElement('div');
  item.className = 'active-filter-item';
  item.innerHTML = `
    <strong>${facet.id}:</strong> ${facet.activeFilter}
    <button onclick="removeFilter('${facet.id}')">✕</button>
  `;
  filterList.appendChild(item);
}
```

### Remove Individual Filters

```javascript
function removeFilter(fieldId) {
  const facets = ixmaps.data.getFacets(currentFilter, null, null, "theme");
  
  // Build new filter without this field
  const filterParts = [];
  for (const facet of facets) {
    if (facet.isActive && facet.id !== fieldId) {
      filterParts.push(facet.activeFilter);
    }
  }
  
  // Apply new filter
  const newFilter = ixmaps.data.buildFilterQuery(filterParts);
  ixmaps.changeThemeStyle("theme", "filter:" + newFilter, "update");
  
  // Refresh facets
  refreshFacets(newFilter);
}
```

### Visual Indicators

```html
<style>
.facet {
  padding: 10px;
  border: 1px solid #ddd;
  margin: 5px 0;
}

.facet.active-facet {
  background: #e8f4f8;
  border-color: #2196F3;
  border-width: 2px;
}

.facet.active-facet::before {
  content: "● ";
  color: #2196F3;
}

.active-filter-badge {
  background: #2196F3;
  color: white;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  margin-left: 5px;
}
</style>

<div class="facet" id="facet-category">
  <h4>
    Category
    <span class="active-filter-badge" style="display: none;">ACTIVE</span>
  </h4>
  <!-- facet controls -->
</div>
```

```javascript
// Update badge visibility
for (const facet of facets) {
  const badge = document.querySelector(`#facet-${facet.id} .active-filter-badge`);
  if (badge) {
    badge.style.display = facet.isActive ? 'inline-block' : 'none';
  }
}
```

---

## Complete Example: Active Filters Panel

```javascript
// Get facets with current filter
const currentFilter = 'WHERE "price" BETWEEN 100 AND 500 AND "category" = "Hotel"';
const facets = ixmaps.data.getFacets(currentFilter, null, null, "theme");

// Create active filters panel
function createActiveFiltersPanel(facets) {
  const panel = document.createElement('div');
  panel.className = 'active-filters-panel';
  panel.innerHTML = '<h3>Active Filters</h3>';
  
  const activeFacets = facets.filter(f => f.isActive);
  
  if (activeFacets.length === 0) {
    panel.innerHTML += '<p>No filters applied</p>';
  } else {
    const list = document.createElement('ul');
    
    for (const facet of activeFacets) {
      const item = document.createElement('li');
      item.innerHTML = `
        <div class="filter-item">
          <span class="field-name">${facet.id}</span>
          <span class="filter-value">${parseFilterValue(facet.activeFilter)}</span>
          <button class="remove-btn" onclick="removeFilter('${facet.id}')">
            Remove
          </button>
        </div>
      `;
      list.appendChild(item);
    }
    
    panel.appendChild(list);
    
    // Add "Clear All" button
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear All Filters';
    clearBtn.onclick = clearAllFilters;
    panel.appendChild(clearBtn);
  }
  
  return panel;
}

// Parse filter to human-readable format
function parseFilterValue(filterString) {
  // "price" BETWEEN 100 AND 500 → "100 - 500"
  if (filterString.includes('BETWEEN')) {
    const match = filterString.match(/BETWEEN (.*?) AND (.*?)$/);
    return match ? `${match[1]} - ${match[2]}` : filterString;
  }
  
  // "category" = "Hotel" → "Hotel"
  if (filterString.includes(' = ')) {
    const match = filterString.match(/= "(.*)"/);
    return match ? match[1] : filterString;
  }
  
  // "region" IN ("North","South") → "North, South"
  if (filterString.includes(' IN ')) {
    const match = filterString.match(/IN \((.*)\)/);
    if (match) {
      return match[1].replace(/"/g, '').replace(/,/g, ', ');
    }
  }
  
  return filterString;
}

// Clear all filters
function clearAllFilters() {
  ixmaps.changeThemeStyle("theme", "filter:", "update");
  refreshFacets('');
}

// Remove specific filter
function removeFilter(fieldId) {
  const facets = ixmaps.data.getFacets(currentFilter, null, null, "theme");
  
  const filterParts = facets
    .filter(f => f.isActive && f.id !== fieldId)
    .map(f => f.activeFilter);
  
  const newFilter = ixmaps.data.buildFilterQuery(filterParts);
  ixmaps.changeThemeStyle("theme", "filter:" + newFilter, "update");
  refreshFacets(newFilter);
}

// Render the panel
document.getElementById('filters-container').appendChild(
  createActiveFiltersPanel(facets)
);
```

---

## Detecting Filter Changes

```javascript
let previousFilters = new Set();

function checkFilterChanges(facets) {
  const currentFilters = new Set(
    facets.filter(f => f.isActive).map(f => f.id)
  );
  
  // New filters added
  const added = [...currentFilters].filter(x => !previousFilters.has(x));
  
  // Filters removed
  const removed = [...previousFilters].filter(x => !currentFilters.has(x));
  
  if (added.length > 0) {
    console.log('Filters added:', added);
    animateFilterAddition(added);
  }
  
  if (removed.length > 0) {
    console.log('Filters removed:', removed);
    animateFilterRemoval(removed);
  }
  
  previousFilters = currentFilters;
}
```

---

## CSS Example

```css
/* Facet container */
.facet {
  padding: 12px;
  margin: 8px 0;
  border: 2px solid transparent;
  border-radius: 4px;
  transition: all 0.3s ease;
}

/* Active facet highlighting */
.facet.active {
  background: linear-gradient(to right, #e3f2fd, #ffffff);
  border-color: #2196F3;
  box-shadow: 0 2px 4px rgba(33, 150, 243, 0.2);
}

/* Active indicator dot */
.facet.active::before {
  content: "";
  display: inline-block;
  width: 8px;
  height: 8px;
  background: #2196F3;
  border-radius: 50%;
  margin-right: 8px;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* Active filter badge */
.active-badge {
  background: #2196F3;
  color: white;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: bold;
  margin-left: 8px;
}

/* Filter value display */
.filter-value-display {
  color: #2196F3;
  font-weight: 500;
  margin-top: 4px;
  font-size: 12px;
}

/* Remove filter button */
.remove-filter-btn {
  background: #f44336;
  color: white;
  border: none;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  margin-left: 8px;
}

.remove-filter-btn:hover {
  background: #d32f2f;
}
```

---

## Benefits

1. ✅ **Visual Feedback** - Users can see which filters are active
2. ✅ **Easy Removal** - Click to remove individual filters
3. ✅ **Filter Overview** - Display all active filters in one place
4. ✅ **State Management** - Track filter changes over time
5. ✅ **Better UX** - Clear indication of current data filtering

---

## API Summary

### Facet Properties

```typescript
interface Facet {
  id: string;
  type: 'numeric' | 'textual' | 'categorical';
  isActive: boolean;              // ← NEW
  activeFilter: string | null;    // ← NEW
  getFilter: (...args) => string | null;
  // ... other properties
}
```

### Usage

```javascript
// Get facets
const facets = ixmaps.data.getFacets(currentFilter, ...);

// Check if facet is active
if (facet.isActive) {
  console.log(`${facet.id} is filtered by: ${facet.activeFilter}`);
}

// Get all active facets
const active = facets.filter(f => f.isActive);

// Build filter excluding one field
const filters = facets
  .filter(f => f.isActive && f.id !== 'price')
  .map(f => f.activeFilter);
const newQuery = ixmaps.data.buildFilterQuery(filters);
```

---

## Questions & Support

For questions about active filter information, contact: guenter.richter@medienobjekte.de

