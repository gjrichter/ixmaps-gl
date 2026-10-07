# ixmaps.data Facet Filtering API Documentation

## Overview

The ixmaps facet filtering system provides dynamic data filtering capabilities for map visualizations. It consists of two main components:

1. **`facet.js`**: Core facet creation and data analysis
2. **`show_facets.js`**: UI rendering and filter management

---

## Main API Functions

### `ixmaps.data.getFacets(szFilter, szDiv, szFieldsA, szId, szMap, fFlag)`

Creates facet objects from theme data for interactive filtering.

**Parameters:**
- `szFilter` (string): Current SQL-like filter query (e.g., `"WHERE field = 'value'"`)
- `szDiv` (string): Target div ID for rendering facets (optional)
- `szFieldsA` (array): Array of field names to process. If `null`, processes all fields
- `szId` (string): Theme ID to analyze
- `szMap` (string): Map ID (optional, default: `"map"`)
- `fFlag` (string): Processing flags (e.g., `"NONUMERIC"` to force textual treatment)

**Returns:** Array of facet objects

**Example:**
```javascript
const facetsA = ixmaps.data.getFacets(
    "WHERE status = 'active'",
    "facets",
    ["power_user_groups", "host_since"],
    "waffle",
    "map",
    "NONUMERIC"
);
```

---

### `ixmaps.data.showFacets(szFilter, szDiv, facetsA)`

Renders HTML UI for facet filters in the sidebar.

**Parameters:**
- `szFilter` (string): Current filter query
- `szDiv` (string): Target div ID where facets will be rendered
- `facetsA` (array): Array of facet objects from `getFacets()`

**Returns:** void

**Example:**
```javascript
const facetsA = ixmaps.data.getFacets(...);
ixmaps.data.showFacets("", "sidebar_facets", facetsA);
```

---

## Global State Variables

All facet state is stored in the `ixmaps.data` namespace:

| Variable | Type | Description |
|----------|------|-------------|
| `facetsFilterA` | Array | Active facet filter parts (without WHERE) |
| `facetsBaseFilter` | String | Initial non-facet filter (preserved) |
| `facetsRangesA` | Object | Range data for numeric facets |
| `facetsQueryA` | Array | Filter queries for click handlers |
| `facetsLastActiveField` | String | Most recently activated facet field |
| `facetsSortActiveFirst` | Boolean | Toggle to sort active facets to top (only if >1 active) |
| `facetsCurrentA` | Array | Current facets array for rendering |

**Example:**
```javascript
// Access current filter state
console.log(ixmaps.data.facetsFilterA);  // ["field1" = "value1", "field2" BETWEEN 10 AND 20]
console.log(ixmaps.data.facetsLastActiveField);  // "field2"
```

---

## Facet Object Structure

Each facet object in the `facetsA` array has the following properties:

### Common Properties (all facet types)

| Property | Type | Description |
|----------|------|-------------|
| `id` | String | Field name |
| `type` | String | Facet type: `"numeric"`, `"textual"`, or `"categorical"` |
| `uniqueValues` | Number | Number of unique values |
| `isActive` | Boolean | Whether this facet has an active filter |
| `activeFilter` | String | Current filter string if active |
| `getFilter()` | Function | Generates filter query from selections |

### Numeric Facet Properties

| Property | Type | Description |
|----------|------|-------------|
| `min` | Number | Minimum value in data |
| `max` | Number | Maximum value in data |
| `sum` | Number | Sum of all values |
| `data` | Array | Array of numeric values |
| `values` | Array | Same as `data` |

**Example:**
```javascript
{
    id: "price",
    type: "numeric",
    min: 10.5,
    max: 5000.0,
    sum: 125000,
    uniqueValues: 245,
    data: [10.5, 25.0, 50.0, ...],
    values: [10.5, 25.0, 50.0, ...],
    isActive: false,
    activeFilter: null,
    getFilter: function(min, max) { return `"price" BETWEEN ${min} AND ${max}`; }
}
```

### Textual Facet Properties

| Property | Type | Description |
|----------|------|-------------|
| `values` | Array | Unique values (sorted by count) |
| `valuesCount` | Object | Map of value → count |
| `nCount` | Number | Total number of records |
| `nValuesSum` | Number | Sum of weighted values (if weights used) |
| `example` | Any | Example value (for text input hints) |

**Example:**
```javascript
{
    id: "city",
    type: "textual",
    values: ["New York", "Paris", "London", ...],
    valuesCount: { "New York": 150, "Paris": 80, ... },
    uniqueValues: 15,
    nCount: 500,
    nValuesSum: 500,
    isActive: false,
    activeFilter: null,
    getFilter: function(selectedValues) { 
        if (selectedValues.length === 1) {
            return `"city" = "${selectedValues[0]}"`;
        }
        return `"city" IN (${selectedValues.map(v => `"${v}"`).join(',')})`;
    }
}
```

### Categorical Facet (Many Unique Values)

Similar to textual facet, but may not include full value list if there are too many values.

---

## Filter Functions

### `__setFacetFilter(szFilter)` (internal)

Adds or removes a facet filter, applying it to all themes on the map.

**Example:**
```javascript
// Internal usage - called by UI interactions
__setFacetFilter('WHERE "city" = "Paris"');
```

---

### `__setRangeFilter(szField, szRange, min, max)` (internal)

Sets a range filter for numeric fields.

**Parameters:**
- `szField`: Field name
- `szRange`: Comma-separated range string (e.g., `"10,500"`)
- `min`, `max`: Numeric bounds (typically not used, extracted from `szRange`)

**Example:**
```javascript
__setRangeFilter("price", "100,500", 0, 0);
```

---

### `__setFilter(szField, szFilter)` (internal)

Sets a text input filter (supports pattern matching with LIKE).

**Parameters:**
- `szField`: Field name
- `szFilter`: Filter value (supports wildcards)

**Example:**
```javascript
__setFilter("name", "Smith*");  // Matches "Smith", "Smithson", etc.
```

---

### `__removeFacets(szField)` (internal)

Removes all filters for a specific field.

**Parameters:**
- `szField`: Field name

**Example:**
```javascript
__removeFacets("city");
```

---

### `__toggleSortActiveFacets()` (global)

Toggles whether active facets are sorted to the top of the list.

**Usage:**
```html
<button onclick="__toggleSortActiveFacets()">Toggle Sort</button>
```

---

## Advanced Filter Utilities

### `ixmaps.data.buildFilterQuery(filterParts)`

Combines multiple filter parts into a WHERE clause.

**Parameters:**
- `filterParts` (Array): Array of filter strings

**Returns:** Complete WHERE clause or empty string

**Example:**
```javascript
const filterParts = ['"city" = "Paris"', '"price" BETWEEN 100 AND 500'];
const query = ixmaps.data.buildFilterQuery(filterParts);
// Returns: "WHERE "city" = "Paris" AND "price" BETWEEN 100 AND 500"
```

---

### `ixmaps.data.buildFilterFromFacets(facets)`

Builds a filter query from facet selections.

**Parameters:**
- `facets` (Array): Array of facet objects with `selection` property

**Returns:** Complete WHERE clause

**Example:**
```javascript
const facets = [
    { id: "city", selection: ["Paris", "London"], getFilter: ... },
    { id: "price", selection: [100, 500], getFilter: ... }
];
const query = ixmaps.data.buildFilterFromFacets(facets);
```

---

## Facet Creation Logic

The system automatically determines facet type based on data characteristics:

1. **Numeric Range Facet**: Created when:
   - All values are numeric
   - Many unique values (>50% of sample size)
   - No `NONUMERIC` flag

2. **Textual Facet with Value List**: Created when:
   - Non-numeric values
   - Few unique values (< 50)
   - Not flagged as categorical

3. **Text Input Facet**: Created when:
   - Many unique text values
   - Typed input needed for filtering

4. **Categorical Facet**: Created when:
   - Many unique values
   - May or may not include full value list (depending on count)

---

## Configuration

Facet behavior is controlled by constants in `facet.js`:

| Constant | Default | Description |
|----------|---------|-------------|
| `MAX_SAMPLE_SIZE` | 250 | Max sample size for uniqueness check |
| `MAX_UNIQUE_FOR_TEXT_FACET` | 50 | Max unique values for value list |
| `MAX_VALUES_TO_DISPLAY` | 200 | Max values to show in categorical facet |
| `UNIQUE_THRESHOLD_RATIO` | 0.5 | Ratio to consider "many unique values" |

---

## Complete Usage Example

```javascript
// 1. Get facet data for visible map extent
const facetsA = ixmaps.data.getFacets(
    "",  // No base filter
    "facets",  // Div ID
    null,  // All fields
    "waffle",  // Theme ID
    "map",  // Map ID
    ""  // No flags
);

// 2. Render facets in sidebar
ixmaps.data.showFacets("", "facets", facetsA);

// 3. Monitor filter changes
ixmaps.htmlgui_onDrawTheme = function() {
    // Recalculate facets based on visible data
    const visibleFacetsA = ixmaps.data.getFacets(
        ixmaps.getThemeObj("waffle").szFilter,
        "facets",
        null,
        "waffle",
        "map",
        ""
    );
    ixmaps.data.showFacets(ixmaps.getThemeObj("waffle").szFilter, "facets", visibleFacetsA);
};
```

---

## Helper Functions (Available for Testing)

```javascript
// Access facet helpers for custom processing
ixmaps.data.facetHelpers.getUniqueValues(array);  // Get unique values
ixmaps.data.facetHelpers.scanValue(value);  // Parse numeric values
ixmaps.data.facetHelpers.countValues(values, weights);  // Count occurrences
ixmaps.data.facetHelpers.isNumericField(values);  // Check if numeric
```

---

## Notes

- **Filter Persistence**: Filters are stored in `ixmaps.data.facetsFilterA` and persist across theme redraws
- **Base Filter Separation**: Non-facet filters are stored separately in `ixmaps.data.facetsBaseFilter`
- **Active Facet Tracking**: The most recently activated field is tracked in `ixmaps.data.facetsLastActiveField` for scrolling behavior
- **Dynamic Sorting**: Active facets can be sorted to the top, but only if there are multiple active facets
- **Word Cloud Support**: Text fields with many unique values can display word clouds for pattern exploration

---

## Author

Guenter Richter  
guenter.richter@medienobjekte.de

## License

CC BY SA / MIT

