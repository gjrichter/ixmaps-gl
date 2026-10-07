# Facet Filter Integration Guide

## Overview

Each facet object now includes a `getFilter()` method that generates the appropriate SQL-like filter string based on user selection. This makes it easy to apply filters to your data.

---

## Facet Types and Their Filters

### 1. **Numeric Range Facet**

**Properties:**
- `type: 'numeric'`
- `min` - Minimum value
- `max` - Maximum value
- `getFilter(minVal, maxVal)` - Filter generator

**Usage:**
```javascript
const facet = {
  id: "price",
  type: "numeric",
  min: 0,
  max: 1000,
  getFilter: (minVal, maxVal) => { ... }
};

// User selects range 100-500
const filter = facet.getFilter(100, 500);
// Returns: "price" BETWEEN 100 AND 500
```

---

### 2. **Textual Facet (with value list)**

**Properties:**
- `type: 'textual'`
- `values` - Array of unique values
- `valuesCount` - Count of each value
- `getFilter(selectedValues)` - Filter generator

**Usage:**
```javascript
const facet = {
  id: "category",
  type: "textual",
  values: ["Hotel", "B&B", "Apartment"],
  getFilter: (selectedValues) => { ... }
};

// User selects single value
const filter1 = facet.getFilter(["Hotel"]);
// Returns: "category" = "Hotel"

// User selects multiple values
const filter2 = facet.getFilter(["Hotel", "B&B"]);
// Returns: "category" IN ("Hotel","B&B")
```

---

### 3. **Textual Facet (input field)**

**Properties:**
- `type: 'textual'`
- `example` - Example value
- `getFilter(inputValue, usePattern)` - Filter generator

**Usage:**
```javascript
const facet = {
  id: "name",
  type: "textual",
  example: "Hotel Roma",
  getFilter: (inputValue, usePattern) => { ... }
};

// Exact match
const filter1 = facet.getFilter("Hotel Roma");
// Returns: "name" = "Hotel Roma"

// Pattern matching with wildcards
const filter2 = facet.getFilter("Hotel%", true);
// Returns: "name" LIKE "Hotel%"
```

---

### 4. **Categorical Facet**

**Properties:**
- `type: 'categorical'`
- `values` - Array of values (if < 200)
- `valuesCount` - Count of each value
- `getFilter(selectedValues)` - Filter generator

**Usage:**
```javascript
const facet = {
  id: "region",
  type: "categorical",
  values: ["North", "South", "East", "West"],
  getFilter: (selectedValues) => { ... }
};

// Single selection
const filter = facet.getFilter(["North"]);
// Returns: "region" = "North"

// Multiple selection
const filter2 = facet.getFilter(["North", "South"]);
// Returns: "region" IN ("North","South")
```

---

## Building Complete Filter Queries

### Method 1: Manual Combination

```javascript
// Get facets
const facets = ixmaps.data.getFacets(null, null, null, "myTheme");

// Store user selections
facets[0].selection = [100, 500];  // Numeric range
facets[1].selection = ["Hotel", "B&B"];  // Text values
facets[2].selection = "Roma";  // Text input

// Generate filters
const filters = [];
for (const facet of facets) {
  if (facet.selection) {
    const filter = facet.getFilter(facet.selection);
    if (filter) {
      filters.push(filter);
    }
  }
}

// Combine into WHERE clause
const whereClause = filters.length > 0 
  ? 'WHERE ' + filters.join(' AND ')
  : '';

console.log(whereClause);
// WHERE "price" BETWEEN 100 AND 500 AND "category" IN ("Hotel","B&B") AND "name" = "Roma"
```

### Method 2: Using Helper Functions

```javascript
// Get facets
const facets = ixmaps.data.getFacets(null, null, null, "myTheme");

// Store user selections on facets
facets[0].selection = [100, 500];
facets[1].selection = ["Hotel"];

// Build filter query automatically
const whereClause = ixmaps.data.buildFilterFromFacets(facets);

console.log(whereClause);
// WHERE "price" BETWEEN 100 AND 500 AND "category" = "Hotel"
```

### Method 3: Build from Filter Parts Array

```javascript
const filterParts = [
  '"price" BETWEEN 100 AND 500',
  '"category" = "Hotel"',
  '"rating" >= 4'
];

const whereClause = ixmaps.data.buildFilterQuery(filterParts);
// WHERE "price" BETWEEN 100 AND 500 AND "category" = "Hotel" AND "rating" >= 4
```

---

## Complete Example: Interactive Filtering

```javascript
// 1. Get facets from theme data
const facets = ixmaps.data.getFacets(null, null, null, "hotels");

// 2. Display facets in UI (simplified)
for (const facet of facets) {
  if (facet.type === 'numeric') {
    // Create slider
    createSlider(facet.id, facet.min, facet.max, (min, max) => {
      facet.selection = [min, max];
      applyFilters();
    });
  } else if (facet.type === 'textual' && facet.values) {
    // Create checkbox list
    createCheckboxList(facet.id, facet.values, (selected) => {
      facet.selection = selected;
      applyFilters();
    });
  }
}

// 3. Apply filters when user makes selections
function applyFilters() {
  // Build filter query
  const whereClause = ixmaps.data.buildFilterFromFacets(facets);
  
  // Re-generate facets with new filter
  const newFacets = ixmaps.data.getFacets(
    whereClause,  // Current filter
    null,
    null,
    "hotels"
  );
  
  // Update UI with new counts
  updateFacetCounts(newFacets);
  
  // Update map theme
  ixmaps.changeThemeStyle("hotels", "filter:" + whereClause, "update");
}
```

---

## Advanced: Pattern Matching

For text fields with many unique values, you can use SQL LIKE patterns:

```javascript
const facet = facets.find(f => f.id === "name");

// Match names starting with "Hotel"
const filter1 = facet.getFilter("Hotel%", true);
// "name" LIKE "Hotel%"

// Match names containing "Roma"
const filter2 = facet.getFilter("%Roma%", true);
// "name" LIKE "%Roma%"

// Match names ending with "Beach"
const filter3 = facet.getFilter("%Beach", true);
// "name" LIKE "%Beach"
```

---

## API Reference

### `facet.getFilter(selection, ...options)`

**Numeric facets:**
```javascript
getFilter(minValue, maxValue) -> string
```

**Textual facets (with values):**
```javascript
getFilter(selectedValues: Array) -> string
```

**Textual facets (input field):**
```javascript
getFilter(inputValue: string|Array, usePattern: boolean) -> string
```

**Categorical facets:**
```javascript
getFilter(selectedValues: Array) -> string
```

### `ixmaps.data.buildFilterQuery(filterParts)`

Combines array of filter strings into WHERE clause.

**Parameters:**
- `filterParts` - Array of filter strings

**Returns:** Complete WHERE clause or empty string

### `ixmaps.data.buildFilterFromFacets(facets)`

Builds WHERE clause from facets with `.selection` property set.

**Parameters:**
- `facets` - Array of facet objects with selections

**Returns:** Complete WHERE clause

---

## Tips & Best Practices

1. **Store selections on facet objects**
   ```javascript
   facet.selection = userSelection;
   ```

2. **Null checks**
   ```javascript
   if (facet.selection) {
     const filter = facet.getFilter(facet.selection);
   }
   ```

3. **Regenerate facets after filtering**
   ```javascript
   // Apply filter to get updated counts
   const newFacets = ixmaps.data.getFacets(whereClause, ...);
   ```

4. **Handle empty selections**
   ```javascript
   // getFilter() returns null if selection is empty
   const filter = facet.getFilter(facet.selection);
   if (filter) {
     filters.push(filter);
   }
   ```

5. **Escape special characters in values**
   - Single quotes in values are automatically handled
   - Double quotes in field names are required

---

## Migration from Old Code

**Before:**
```javascript
// Manual filter construction
const filter = '"category" = "Hotel"';
```

**After:**
```javascript
// Use facet's getFilter method
const filter = facet.getFilter(["Hotel"]);
```

This ensures consistent filter syntax and reduces errors!

---

## Troubleshooting

**Problem:** getFilter returns null
- **Solution:** Check if selection is empty or undefined

**Problem:** Filter syntax error
- **Solution:** Field names must be in double quotes: `"field_name"`

**Problem:** Values not matching
- **Solution:** Check for trailing spaces, case sensitivity

---

## Questions & Support

For questions about facet filters, contact: guenter.richter@medienobjekte.de

