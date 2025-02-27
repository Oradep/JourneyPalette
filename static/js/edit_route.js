$(document).ready(function(){
    // Функция для отправки AJAX-запроса
    function autoSave() {
        var form = $('form'); // Можно уточнить селектор, если на странице несколько форм
        var formData = form.serialize(); // Собираем данные формы

        $.ajax({
            url: form.attr('action'),
            method: 'POST',
            data: formData,
            success: function(response){
                console.log('Изменения сохранены');
                // Можно добавить уведомление пользователю, например, показать сообщение "Сохранено"
            },
            error: function(){
                console.error('Ошибка при сохранении');
            }
        });
    }

    // Автосохранение при потере фокуса у текстовых полей и textarea
    $('input[type="text"], textarea').on('blur', function(){
        autoSave();
    });
    
    // Если нажата клавиша Enter в текстовых полях или textarea, предотвращаем стандартное поведение и сохраняем данные
    $('input[type="text"], textarea').on('keypress', function(e){
        if(e.which === 13) {
            e.preventDefault();
            autoSave();
        }
    });

    // Автосохранение при изменении чекбокса
    $('input[type="checkbox"]').on('change', function(){
        autoSave();
    });
});

  // Глобальные переменные
  let map;
  let allMarkers = [];      // все точки
  let markers = [];         // обычные точки (синие)
  let landmarkMarkers = []; // достопримечательности (красные)
  let multiRoute = null;
  let currentLandmarkMarker = null; // редактируемый маркер
  const routeId = "{{ route.id }}";
  
  // Генерируем идентификатор сессии при загрузке страницы
  const sessionId = new Date().getTime().toString() + "_" + Math.random().toString(36).substr(2, 5);
  console.log(`[${new Date().toISOString()}] Сессия начата: ${sessionId}`);

  // Функция автоматического сохранения данных в БД через AJAX
  function autoSaveMarkers() {
    const pointsData = JSON.parse(document.getElementById('points').value);
    const landmarksData = JSON.parse(document.getElementById('landmarks').value);
    const allmarkersdata = JSON.parse(document.getElementById('allMarkers').value);
    console.log(`[${new Date().toISOString()}] Автосохранение маркеров. Сессия: ${sessionId}`);
    fetch('/save_markers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        route_id: routeId,
        points: pointsData,
        landmarks: landmarksData,
        allMarkers: allmarkersdata,
        session: sessionId
      })
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        console.log(`[${new Date().toISOString()}] Изменения сохранены. Сессия: ${sessionId}`);
      } else {
        console.error(`[${new Date().toISOString()}] Ошибка сохранения: `, data.error);
      }
    })
    .catch(err => console.error(`[${new Date().toISOString()}] Ошибка запроса:`, err));
  }

  // Обновление скрытых полей и автоматическое сохранение
  function updateHiddenInputs() {
    const pointsData = allMarkers.map(marker => {
      const coords = marker.geometry.getCoordinates();
      return { lat: coords[0], lng: coords[1] };
    });

    const landmarksData = landmarkMarkers.map(marker => {
      const coords = marker.geometry.getCoordinates();
      return {
        lat: coords[0],
        lng: coords[1],
        name: marker.landmarkData ? marker.landmarkData.name : '',
        description: marker.landmarkData ? marker.landmarkData.description : '',
        photo_url: marker.landmarkData ? marker.landmarkData.photo_url : ''
      };
    });

    document.getElementById('allMarkers').value = JSON.stringify(allMarkers.map(marker => {
      const coords = marker.geometry.getCoordinates();
      return { lat: coords[0], lng: coords[1] };
    }));
    document.getElementById('landmarks').value = JSON.stringify(landmarksData);
    document.getElementById('points').value = JSON.stringify(pointsData);

    console.log(`[${new Date().toISOString()}] Обновление скрытых полей. Сессия: ${sessionId}`);
    autoSaveMarkers();
  }

  // Функция добавления маркера. Параметр isLandmark определяет тип точки.
  function addMarker(coordsObj, isLandmark, landmarkData = {}, isInit=false) {
    const coords = [coordsObj.lat, coordsObj.lng];
    const marker = new ymaps.Placemark(coords, {}, { draggable: true });
    marker.isLandmark = isLandmark;
    
    if (isLandmark) {
      marker.options.set('preset', 'islands#redIcon');
      marker.landmarkData = {
        name: landmarkData.name || '',
        description: landmarkData.description || '',
        photo_url: landmarkData.photo_url || ''
      };
      marker.properties.set('hintContent', marker.landmarkData.name || 'Достопримечательность');
      landmarkMarkers.push(marker);
    } else {
      marker.options.set('preset', 'islands#blueIcon');
      marker.properties.set('hintContent', 'Обычная точка маршрута');
      markers.push(marker);
    }
    allMarkers.push(marker);

    // События перетаскивания – обновляем положение и сохраняем изменения
    marker.events.add("drag", updateMultiRoute);
    marker.events.add("dragend", updateHiddenInputs);

    // ЛКМ по маркеру: удаление точки
    marker.events.add("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      removeMarker(marker);
      updateMultiRoute();
    });

    // ПКМ по маркеру: открытие окна редактирования (точка не создаётся новая)
    marker.events.add("contextmenu", function(e) {
      e.preventDefault();
      e.stopPropagation();
      openLandmarkEditor(marker);
    });

    map.geoObjects.add(marker);

    if (!isInit) {
      updateHiddenInputs();
    }
    return marker;
  }

  // Удаление маркера с карты и из массивов
  function removeMarker(marker) {
    map.geoObjects.remove(marker);
    markers = markers.filter(m => m !== marker);
    allMarkers = allMarkers.filter(m => m !== marker);
    landmarkMarkers = landmarkMarkers.filter(m => m !== marker);
    updateHiddenInputs();
  }

  // Обновление мультимаршрута по обычным точкам
  function updateMultiRoute() {
    const referencePoints = allMarkers;
    if (multiRoute) {
      map.geoObjects.remove(multiRoute);
      multiRoute = null;
    }
    if (referencePoints.length > 1) {
      multiRoute = new ymaps.multiRouter.MultiRoute({
        referencePoints: referencePoints,
        params: { routingMode: 'auto' }
      }, {
        boundsAutoApply: false,
        wayPointVisible: false,
        routeBalloonVisible: false,
        routeBalloonAutoOpen: false,
        routeStrokeWidth: 4,
        routeStrokeColor: "#1E90FF",
        routeActiveStrokeWidth: 6,
        routeActiveStrokeColor: "#FF4500",
        routeActiveStrokeStyle: "solid",
        routeStrokeStyle: "solid",
        routeActiveMarkerVisible: false,
        pinVisible: false
      });
      map.geoObjects.add(multiRoute);
    }
  }

  // Открытие окна редактирования для выбранного маркера
  function openLandmarkEditor(marker) {
    currentLandmarkMarker = marker;
    if (!marker.originalLandmarkData) {
      marker.originalLandmarkData = Object.assign({}, marker.landmarkData);
    }
    document.getElementById('landmark-name').value = marker.landmarkData ? marker.landmarkData.name : '';
    document.getElementById('landmark-description').value = marker.landmarkData ? marker.landmarkData.description : '';
    document.getElementById('landmark-photo').value = marker.landmarkData ? marker.landmarkData.photo_url : '';
    document.getElementById('landmark-editor').style.display = 'block';
    fetchNearbyObject(marker);
  }

  // Сохранение данных редактирования. Если точка не была достопримечательностью – переводим её в этот режим
  function saveLandmarkData(e) {
    e.preventDefault();
    if (!currentLandmarkMarker) return;
    currentLandmarkMarker.landmarkData = {
      name: document.getElementById('landmark-name').value,
      description: document.getElementById('landmark-description').value,
      photo_url: document.getElementById('landmark-photo').value
    };
    currentLandmarkMarker.properties.set('hintContent', currentLandmarkMarker.landmarkData.name || 'Достопримечательность');

    if (!currentLandmarkMarker.isLandmark) {
      currentLandmarkMarker.isLandmark = true;
      currentLandmarkMarker.options.set('preset', 'islands#redIcon');
      markers = markers.filter(m => m !== currentLandmarkMarker);
      landmarkMarkers.push(currentLandmarkMarker);
      console.log(`[${new Date().toISOString()}] Маркер переведен в достопримечательность.`, currentLandmarkMarker);
    }
    updateHiddenInputs();
    delete currentLandmarkMarker.originalLandmarkData;
    document.getElementById('landmark-editor').style.display = 'none';
    currentLandmarkMarker = null;
  }

  // Отмена редактирования – восстанавливаем исходные данные
  function cancelLandmarkEdit(e) {
    e.preventDefault();
    if (currentLandmarkMarker && currentLandmarkMarker.originalLandmarkData) {
      currentLandmarkMarker.landmarkData = Object.assign({}, currentLandmarkMarker.originalLandmarkData);
      if (currentLandmarkMarker.isLandmark) {
        currentLandmarkMarker.properties.set('hintContent', currentLandmarkMarker.landmarkData.name || 'Достопримечательность');
      }
    }
    document.getElementById('landmark-editor').style.display = 'none';
    currentLandmarkMarker = null;
    updateHiddenInputs();
  }

  // Удаление точки через окно редактирования
  function deleteLandmarkData(e) {
    e.preventDefault();
    if (currentLandmarkMarker) {
      removeMarker(currentLandmarkMarker);
    }
    document.getElementById('landmark-editor').style.display = 'none';
    currentLandmarkMarker = null;
    updateMultiRoute();
  }

  // Автоматический парсинг ближайшего объекта через геокодер Яндекс.Карт
  function fetchNearbyObject(marker) {
    const coords = marker.geometry.getCoordinates();
    ymaps.geocode(coords, { results: 1 }).then(function(res) {
      const firstObject = res.geoObjects.get(0);
      if (firstObject) {
        const properties = firstObject.properties.getAll();
        const name = properties.name || '';
        const description = properties.description || '';
        const photo_url = ''; // При наличии API можно задать URL
        if (!marker.landmarkData.name) marker.landmarkData.name = name;
        if (!marker.landmarkData.description) marker.landmarkData.description = description;
        if (!marker.landmarkData.photo_url) marker.landmarkData.photo_url = photo_url;
        if (currentLandmarkMarker === marker) {
          document.getElementById('landmark-name').value = marker.landmarkData.name;
          document.getElementById('landmark-description').value = marker.landmarkData.description;
          document.getElementById('landmark-photo').value = marker.landmarkData.photo_url;
        }
        marker.properties.set('hintContent', marker.landmarkData.name || 'Достопримечательность');
        updateHiddenInputs();
      }
    });
  }

  function init() {
      const rawValue = document.getElementById('allMarkers').value;
      if (Array.isArray(rawValue) && rawValue.length === 2 || typeof rawValue === 'string' && rawValue.length > 5){
          let markers;
          markers = JSON.parse(JSON.parse(rawValue)); // Двойной парсинг
          const firstMarker = markers[0];
          const lat = firstMarker?.lat;
          const lng = firstMarker?.lng;
          center = [lat, lng];
      } else {
          center = ['55.755864', '37.617698']
      }



    map = new ymaps.Map("map", {
      center: center,
      zoom: 10
    });

    // Загружаем все маркеры из скрытого поля allMarkers
    const allMarkersField = document.getElementById('allMarkers');
    let savedMarkers = [];
    try {
      savedMarkers = JSON.parse(allMarkersField.value || '[]');
      if (!Array.isArray(savedMarkers)) {
        savedMarkers = JSON.parse(savedMarkers);
        if (!Array.isArray(savedMarkers)) {
          console.error("allMarkers не является массивом");
          savedMarkers = [];
        }
      }
    } catch (e) {
      console.error("Ошибка парсинга allMarkers:", e);
      savedMarkers = [];
    }

    // Загружаем данные по достопримечательностям из скрытого поля landmarks
    const landmarksField = document.getElementById('landmarks');
    let savedLandmarks = [];
    try {
      savedLandmarks = JSON.parse(landmarksField.value || '[]');
      if (!Array.isArray(savedLandmarks)) {
        savedLandmarks = JSON.parse(savedLandmarks);
        if (!Array.isArray(savedLandmarks)) {
          console.error("landmarks не является массивом");
          savedLandmarks = [];
        }
      }
    } catch (e) {
      console.error("Ошибка парсинга landmarks:", e);
      savedLandmarks = [];
    }

    // Инициализация маркеров согласно порядку в savedMarkers
    savedMarkers.forEach(markerData => {
      let isLandmark = false;
      let lmData = {};
      for (let lm of savedLandmarks) {
        if (lm.lat === markerData.lat && lm.lng === markerData.lng) {
          isLandmark = true;
          lmData = lm;
          break;
        }
      }
      addMarker({ lat: markerData.lat, lng: markerData.lng }, isLandmark, lmData, true);
    });

    updateMultiRoute();

    // ЛКМ по карте: добавляем обычную точку
    map.events.add("click", function(e) {
      if (!e.get("target") || !e.get("target").geometry) {
        const coords = e.get("coords");
        addMarker({ lat: coords[0], lng: coords[1] }, false);
        updateMultiRoute();
      }
    });

    // ПКМ по карте: если клик вне объектов, создаём новую точку и открываем окно редактирования
    map.events.add("contextmenu", function(e) {
      const target = e.get("target");
      if (target && target.geometry) return;
      e.preventDefault();
      const coords = e.get("coords");
      const marker = addMarker({ lat: coords[0], lng: coords[1] }, false);
      updateMultiRoute();
      openLandmarkEditor(marker);
    });

    // Обработчики кнопок редактора достопримечательностей
    document.getElementById('save-landmark').addEventListener('click', saveLandmarkData);
    document.getElementById('cancel-landmark').addEventListener('click', cancelLandmarkEdit);
    document.getElementById('delete-landmark').addEventListener('click', deleteLandmarkData);
  }

  ymaps.ready(() => {
    console.log(`[${new Date().toISOString()}] Yandex Maps API загружен`);
    init();
  });