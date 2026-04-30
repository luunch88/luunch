(function () {
  const filterRx = {
    asiatiskt: /kines|japan|asian|wok|thai|vietnam|korea|noodle|ramen/i,
    burgare: /burger|hamburgare|grill|bbq/i,
    pizza: /pizza|pizzeria/i,
    sushi: /sushi|maki|japan/i,
    vegetariskt: /vegan|vegetar|sallad|bowl/i,
    thai: /thai|bangkok/i,
    indiskt: /india|indisk|curry|tandoor/i
  };

  function getEmoji(tags = {}) {
    const c = (tags.name || '') + (tags.cuisine || '');
    if (/sushi|maki|japan/i.test(c)) return '🍣';
    if (/pizza/i.test(c)) return '🍕';
    if (/burger|hamburgare/i.test(c)) return '🍔';
    if (/thai|vietnam|wok|noodle|ramen/i.test(c)) return '🍜';
    if (/india|curry|tandoor/i.test(c)) return '🫓';
    if (/vegan|vegetar|sallad|bowl/i.test(c)) return '🥗';
    if (tags.amenity === 'cafe' || tags.amenity === 'bakery') return '☕';
    if (tags.amenity === 'bar' || tags.amenity === 'pub') return '🍺';
    return '🍽️';
  }

  function getTypeLabel(tags = {}) {
    if (tags.cuisine) return tags.cuisine.replace(/_/g, ' ').split(';')[0];
    return {
      restaurant: 'Restaurang',
      cafe: 'Café',
      fast_food: 'Fast food',
      bar: 'Bar & mat',
      bakery: 'Bageri',
      pub: 'Pub'
    }[tags.amenity] || 'Restaurang';
  }

  function matchFilter(restaurant, filter) {
    if (filter === 'alla') return true;
    const haystack = [
      restaurant.name,
      restaurant.category,
      restaurant.type_label,
      restaurant.tags?.name,
      restaurant.tags?.cuisine,
      restaurant.tags?.amenity
    ].filter(Boolean).join(' ');
    return filterRx[filter]?.test(haystack) ?? true;
  }

  window.LuunchRestaurants = { getEmoji, getTypeLabel, matchFilter };
})();
