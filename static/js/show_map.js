ymaps.ready(function(){
    // Функция, которая гарантирует, что данные – массив
    function ensureArray(data) {
      return Array.isArray(data) ? data : Object.values(data);
    }
    
    // Читаем данные из скрытых полей
    let pointsData = JSON.parse(document.getElementById('points').value);
    let allMarkersData = JSON.parse(document.getElementById('allMarkers').value);
    let landmarksData = JSON.parse(document.getElementById('landmarks').value);
    
    console.log("pointsData (raw):", pointsData);
    console.log("allMarkersData (raw):", allMarkersData);
    console.log("landmarksData (raw):", landmarksData);
    
    // Приводим данные к массиву
    pointsData = ensureArray(pointsData);
    allMarkersData = ensureArray(allMarkersData);
    landmarksData = ensureArray(landmarksData);
    
    // Приводим координаты к числовым значениям
    allMarkersData = allMarkersData.map(m => ({ lat: Number(m.lat), lng: Number(m.lng) }));
    pointsData = pointsData.map(m => ({ lat: Number(m.lat), lng: Number(m.lng) }));
    landmarksData = landmarksData.map(lm => ({
      lat: Number(lm.lat),
      lng: Number(lm.lng),
      name: lm.name || '',
      description: lm.description || '',
      photo_url: lm.photo_url || '',
      yandex_url: lm.yandex_url || ''
    }));
    
    console.log("allMarkersData (числовые, до фильтра):", allMarkersData);
    console.log("pointsData (числовые):", pointsData);
    console.log("landmarksData (числовые):", landmarksData);
    
    // Фильтруем объекты с недействительными координатами
    allMarkersData = allMarkersData.filter(m => !isNaN(m.lat) && !isNaN(m.lng));
    pointsData = pointsData.filter(m => !isNaN(m.lat) && !isNaN(m.lng));
    landmarksData = landmarksData.filter(m => !isNaN(m.lat) && !isNaN(m.lng));
    
    console.log("allMarkersData (числовые, отфильтрованные):", allMarkersData);
    
    // Если pointsData непустое, а landmarksData пустое, генерируем landmarksData как разницу
    if (pointsData.length > 0 && landmarksData.length === 0) {
      landmarksData = allMarkersData.filter(marker => {
        return !pointsData.some(pt =>
          Math.abs(pt.lat - marker.lat) < 1e-6 &&
          Math.abs(pt.lng - marker.lng) < 1e-6
        );
      });
      console.log("Сгенерированные landmarksData:", landmarksData);
    } else if (pointsData.length === 0) {
      console.warn("pointsData пустое – достопримечательностей не определяем.");
      landmarksData = [];
    }
    
    // Определяем центр карты: используем первую точку из allMarkersData, если есть
    let center = ['55.755864', '37.617698'];
    if (allMarkersData.length > 0) {
      center = [allMarkersData[0].lat, allMarkersData[0].lng];
    }
    console.log("Центр карты:", center);
    
    // Инициализируем карту
    const map = new ymaps.Map("map", {
      center: center,
      zoom: 10
    });
    
    // Функция сравнения координат с допуском
    function coordsEqual(a, b) {
      return Math.abs(a - b) < 1e-6;
    }
    
    // Пример обновлённой функции создания маркера
function createMarker(coordsObj, isLandmark, landmarkData = {}) {
    const coords = [coordsObj.lat, coordsObj.lng];
    if (isNaN(coords[0]) || isNaN(coords[1])) {
      console.warn("Неверные координаты при создании маркера:", coordsObj);
      return null;
    }
    const marker = new ymaps.Placemark(coords, {}, { draggable: false });
    if (isLandmark) {
      marker.options.set('preset', 'islands#redIcon');
      const name = landmarkData.name ? landmarkData.name : "Достопримечательность";
      marker.properties.set('hintContent', name);
      let balloonContent = "<strong>" + name + "</strong>";
      if (landmarkData.description) {
        balloonContent += "<br>" + landmarkData.description;
      }
      if (landmarkData.photo_url) {
        balloonContent += "<br><img src='" + landmarkData.photo_url + "' alt='" + name + "' style='max-width:200px;'>";
      }
      if (landmarkData.yandex_url) {
        balloonContent += "<br><a href='" + landmarkData.yandex_url + "' target='_blank'>Посмотреть на Яндекс.Картах</a>";
      }
      marker.properties.set('balloonContent', balloonContent);
      
      // Убираем ручное открытие балуна,
      // т.к. API сам открывает балун при клике,
      // либо можно использовать такой вариант:
      /*
      marker.events.add("click", function() {
        if (!marker.balloon.isOpen()) {
          marker.balloon.open();
        }
      });
      */
      
      console.log("Создан красный маркер:", coords, "с данными:", landmarkData);
    } else {
      marker.options.set('preset', 'islands#blueIcon');
      marker.properties.set('hintContent', 'Обычная точка маршрута');
      console.log("Создан синий маркер:", coords);
    }
    map.geoObjects.add(marker);
    return marker;
  }
    
    // Создаем маркеры по данным allMarkersData.
    let markersArray = [];
    allMarkersData.forEach(markerData => {
      let isLandmark = false;
      let lmData = {};
      console.log("Обработка точки:", markerData);
      for (let lm of landmarksData) {
        if (coordsEqual(lm.lat, markerData.lat) && coordsEqual(lm.lng, markerData.lng)) {
          isLandmark = true;
          lmData = lm;
          console.log("Точка распознана как достопримечательность:", lm);
          break;
        }
      }
      const marker = createMarker(markerData, isLandmark, lmData);
      if (marker) markersArray.push(marker);
    });
    
    // Если маркеров больше одного, создаем мультимаршрут между ними
    if (markersArray.length > 1) {
      const referencePoints = allMarkersData.map(pt => [pt.lat, pt.lng]);
      const multiRoute = new ymaps.multiRouter.MultiRoute({
        referencePoints: referencePoints,
        params: { routingMode: 'auto' }
      }, {
        boundsAutoApply: true,
        wayPointVisible: false,
        routeBalloonVisible: false,
        routeStrokeWidth: 4,
        routeStrokeColor: "#1E90FF",
        routeActiveStrokeWidth: 6,
        routeActiveStrokeColor: "#FF4500"
      });
      map.geoObjects.add(multiRoute);
      console.log("Создан мультимаршрут между точками:", referencePoints);
    }
  });