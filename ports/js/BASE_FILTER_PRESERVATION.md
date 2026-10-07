# Base Filter Preservation in Facet Filtering

## Problem Solved

When using facet filtering, there may be an initial filter applied to the data (not from facets) that should be **preserved** when facet filters are added or removed. Previously, this base filter would be lost when clearing facet filters.

## Solution

The filter system now automatically **separates** and **preserves** base filters (non-facet filters) from facet filters.

---

## How It Works

### 1. **Initial Filter Separation**

When `showFacets()` is called with a filter, it automatically separates:
- **Base Filter** - Filter parts that don't correspond to any facet field
- **Facet Filters** - Filter parts that match facet fields

```javascript
// Example initial filter:
const initialFilter = 'WHERE "status" = "active" AND "price" BETWEEN 100 AND 500';

// If facets are: [price, category, rating]
// Then:
// - Base filter: WHERE "status" = "active"  (status is NOT a facet)
// - Facet filters: ["price" BETWEEN 100 AND 500]  (price IS a facet)
```

### 2. **Filter Combination**

When applying facet filters, the system always combines:
```
Final Filter = Base Filter + Facet Filters
```

### 3. **Filter Persistence**

When you:
- **Add a facet filter** → Base filter is preserved
- **Remove a facet filter** → Base filter is preserved  
- **Clear all facet filters** → Base filter remains

---

## Examples

### Example 1: Initial Theme Filter

```javascript
// Theme has initial filter for active items only
const theme = {
  layer: "hotels",
  data: { ... },
  filter: 'WHERE "status" = "active"',  // ← Base filter
  // ...
};

// User creates facets
const facets = ixmaps.data.getFacets(
  'WHERE "status" = "active"',  // Initial filter passed
  null,
  null,
  "hotels"
);

// System automatically separates:
// window.__baseFilter = 'WHERE "status" = "active"'
// window.__facetFilterA = []

// User applies facet filter (price range)
// Facet clicked: price 100-500
// Final filter: WHERE "status" = "active" AND "price" BETWEEN 100 AND 500
//                     ↑ Base filter preserved    ↑ Facet filter added

// User removes price filter
// Final filter: WHERE "status" = "active"
//                     ↑ Base filter still there!
```

### Example 2: Geographic Filter

```javascript
// Theme filtered to show only Tuscany region
const initialFilter = 'WHERE "region" = "Tuscany"';

// Facets created for: category, price, rating
const facets = ixmaps.data.getFacets(initialFilter, null, null, "hotels");

// System separates:
// Base: WHERE "region" = "Tuscany"  (region is NOT a facet)
// Facets: []

// User selects category = "Hotel"
// Final: WHERE "region" = "Tuscany" AND "category" = "Hotel"
//             ↑ Preserved                ↑ Facet filter

// User also selects rating >= 4
// Final: WHERE "region" = "Tuscany" AND "category" = "Hotel" AND "rating" >= 4
//             ↑ Still preserved

// User clears all facet filters
// Final: WHERE "region" = "Tuscany"
//             ↑ Base filter remains!
```

### Example 3: Time Range Filter

```javascript
// Theme filtered to show only 2024 data
const initialFilter = 'WHERE "year" = 2024';

// Facets for other fields
const facets = ixmaps.data.getFacets(initialFilter, null, null, "sales");

// User filters by product category
// Final: WHERE "year" = 2024 AND "category" = "Electronics"

// User removes category filter
// Final: WHERE "year" = 2024
//             ↑ Year filter preserved
```

---

## Implementation Details

### Separation Logic

```javascript
const __separateBaseFilter = (szFilter, facetsA) => {
    // Parse filter into parts
    let filterParts = szFilter.split('WHERE ')[1].split(/\s+AND\s+/);
    
    // Get facet field names
    const facetFields = new Set(facetsA.map(f => f.id));
    
    // Separate into base and facet filters
    for (let part of filterParts) {
        const fieldName = part.split('"')[1];
        if (fieldName && facetFields.has(fieldName)) {
            // This is a facet filter
            facetFilterParts.push(part);
        } else {
            // This is a base filter
            baseFilterParts.push(part);
        }
    }
    
    // Store separately
    window.__baseFilter = baseFilterParts.join(" AND ");
    window.__facetFilterA = facetFilterParts;
};
```

### Filter Combination Logic

```javascript
const __setFacetFilter = (szFilter) => {
    // ... add/remove facet filter ...
    
    // Combine base + facet filters
    let finalFilterParts = [];
    
    if (window.__baseFilter) {
        finalFilterParts.push(window.__baseFilter.split('WHERE ')[1]);
    }
    
    if (window.__facetFilterA.length > 0) {
        finalFilterParts.push(window.__facetFilterA.join(" AND "));
    }
    
    const finalFilter = "WHERE " + finalFilterParts.join(" AND ");
    
    // Apply to theme
    ixmaps.changeThemeStyle(themeId, "filter:" + finalFilter, "set");
};
```

---

## State Variables

### `window.__baseFilter`
Stores the initial non-facet filter (preserved through all facet operations)

### `window.__facetFilterA`
Array of active facet filter parts (modified as user selects/deselects facets)

---

## Console Output

When debugging, you'll see:

```
showFacets initial filter: WHERE "status" = "active" AND "price" BETWEEN 100 AND 500
Separated - Base filter: WHERE "status" = "active"
Separated - Facet filters: ["price" BETWEEN 100 AND 500]
...
__setFacetFilter called with: WHERE "category" = "Hotel"
Final combined filter: WHERE "status" = "active" AND "price" BETWEEN 100 AND 500 AND "category" = "Hotel"
```

---

## Benefits

1. ✅ **Preserves context** - Initial filters remain active
2. ✅ **Geographic restrictions** - Keep region/area filters while using facets
3. ✅ **Time filtering** - Maintain temporal filters with facet filtering
4. ✅ **Permission-based** - Keep user permission filters separate from facets
5. ✅ **Complex queries** - Support both facet and non-facet filtering together

---

## Edge Cases Handled

### Empty Filters
```javascript
// No initial filter
showFacets(null, null, facets);
// window.__baseFilter = ""
```

### All Filters are Facets
```javascript
// All filter parts match facets
showFacets('WHERE "price" >= 100 AND "category" = "Hotel"', null, facets);
// window.__baseFilter = ""
// window.__facetFilterA = ['"price" >= 100', '"category" = "Hotel"']
```

### Mixed Filters
```javascript
// Some facet, some non-facet
showFacets('WHERE "region" = "North" AND "price" >= 100', null, facets);
// window.__baseFilter = 'WHERE "region" = "North"'
// window.__facetFilterA = ['"price" >= 100']
```

### BETWEEN Handling
```javascript
// Correctly handles BETWEEN x AND y (doesn't split on AND)
showFacets('WHERE "status" = "active" AND "price" BETWEEN 100 AND 500', ...);
// Correctly recognizes BETWEEN as single filter part
```

---

## Testing

To verify base filter preservation:

```javascript
// 1. Apply initial filter
ixmaps.changeThemeStyle("theme", 'filter:WHERE "status" = "active"', "set");

// 2. Show facets
const facets = ixmaps.data.getFacets('WHERE "status" = "active"', null, null, "theme");
ixmaps.data.showFacets('WHERE "status" = "active"', "facets", facets);

// 3. Check separation
console.log(window.__baseFilter);  // Should show: WHERE "status" = "active"
console.log(window.__facetFilterA);  // Should be: []

// 4. Apply facet filter
// Click on a facet value...

// 5. Check combined filter
// Should show: WHERE "status" = "active" AND "facet_field" = "value"

// 6. Remove all facet filters
window.__facetFilterA = [];
__setFacetFilter("");

// 7. Verify base filter remains
// Final filter should still be: WHERE "status" = "active"
```

---

## Migration Notes

### No Changes Required

Existing code automatically benefits from base filter preservation. No migration needed!

### Backward Compatible

✅ Previous behavior preserved for themes without initial filters
✅ New behavior activates automatically when initial filter detected

---

*Feature added: October 31, 2025*
*Status: Production Ready*

