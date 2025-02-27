$(document).ready(function(){
  // Функция для отправки AJAX-запроса (автосохранение формы)
  function autoSave() {
      var form = $('form');
      var formData = form.serialize();
      $.ajax({
          url: form.attr('action'),
          method: 'POST',
          data: formData,
          success: function(response){
              console.log('Изменения сохранены');
          },
          error: function(){
              console.error('Ошибка при сохранении');
          }
      });
  }

  // Автосохранение при изменениях в текстовых полях, textarea и чекбоксах
  $('input[type="text"], textarea').on('blur keypress', function(e){
      if(e.type === 'keypress' && e.which !== 13) return;
      if(e.which === 13) e.preventDefault();
      autoSave();
  });
  $('input[type="checkbox"]').on('change', autoSave);
});

// Глобальные переменные для работы с картой и маркерами
let map;
let allMarkers = [];      // Все точки
let markers = [];         // Обычные (синие) точки
let landmarkMarkers = []; // Достопримечательности (красные) 
let multiRoute = null;
let currentLandmarkMarker = null; // Редактируемый маркер

// Получаем routeId из скрытого поля
let routeIdElement = document.getElementById('route-id');
let routeId = routeIdElement ? parseInt(routeIdElement.value, 10) : NaN;
if(isNaN(routeId)) {
    console.error("Route id не задан или имеет некорректное значение.");
}

const sessionId = new Date().getTime().toString() + "_" + Math.random().toString(36).substr(2, 5);
console.log(`[${new Date().toISOString()}] Сессия начата: ${sessionId}`);

// Функция автосохранения маркеров через AJAX
function autoSaveMarkers() {
  if(isNaN(routeId)) {
      console.error("Автосохранение отменено: routeId не задан.");
      return;
  }
  const pointsData = JSON.parse(document.getElementById('points').value);
  const landmarksData = JSON.parse(document.getElementById('landmarks').value);
  const allmarkersdata = JSON.parse(document.getElementById('allMarkers').value);
  console.log(`[${new Date().toISOString()}] Автосохранение маркеров. Сессия: ${sessionId}`);
  fetch('/save_markers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

// Обновление скрытых полей (сериализация координат маркеров) и вызов автосохранения
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

// Функция добавления маркера на карту
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
    marker.events.add("drag", updateMultiRoute);
    marker.events.add("dragend", updateHiddenInputs);
    marker.events.add("click", function(e) {
      e.preventDefault();
      e.stopPropagation();
      removeMarker(marker);
      updateMultiRoute();
    });
    marker.events.add("contextmenu", function(e) {
      e.preventDefault();
      e.stopPropagation();
      openLandmarkEditor(marker);
    });
    map.geoObjects.add(marker);
    if (!isInit) updateHiddenInputs();
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

// Функция открытия окна редактирования для выбранного маркера
function openLandmarkEditor(marker) {
  currentLandmarkMarker = marker;
  // Сохраняем исходные данные, если их ещё нет
  if (!marker.originalLandmarkData) {
    marker.originalLandmarkData = Object.assign({}, marker.landmarkData);
  }
  // Заполняем поля редактора
  document.getElementById('landmark-name').value = marker.landmarkData ? marker.landmarkData.name : '';
  document.getElementById('landmark-description').value = marker.landmarkData ? marker.landmarkData.description : '';
  // Очищаем input типа file (его нельзя программно задать, но можно сбросить выбор)
  $('#landmark-photo').val('');
  // Показываем предпросмотр, если уже есть фото
  if (marker.landmarkData && marker.landmarkData.photo_url) {
    $('#landmark-photo-preview').html('<img src="' + marker.landmarkData.photo_url + '" style="max-height:100px;">');
  } else {
    $('#landmark-photo-preview').empty();
  }
  document.getElementById('landmark-editor').style.display = 'block';
}

// При выборе файла для фото достопримечательности автоматически загружаем его на сервер
$(document).ready(function(){
$('#landmark-photo').on('change', function(){
  var fileInput = $(this)[0];
  if(fileInput.files.length > 0){
    var formData = new FormData();
    formData.append('image', fileInput.files[0]);

    fetch(uploadLandmarkUrl, {
      method: "POST",
      body: formData
    })
    .then(response => response.json())
    .then(data => {
      if(data.success){
        $('#landmark-photo-preview').html('<img src="' + data.file_url + '" style="max-height:100px;">');
        if(!currentLandmarkMarker.landmarkData){
          currentLandmarkMarker.landmarkData = {};
        }
        currentLandmarkMarker.landmarkData.photo_url = data.file_url;
      } else {
        alert("Ошибка загрузки изображения для достопримечательности: " + data.error);
      }
    })
    .catch(err => {
      console.error("Ошибка запроса:", err);
      alert("Ошибка загрузки изображения для достопримечательности.");
    });
    
  }
});
});

// Функция сохранения данных редактирования (при этом используется уже загруженный URL для фото)
function saveLandmarkData(e) {
  e.preventDefault();
  if (!currentLandmarkMarker) return;
  currentLandmarkMarker.landmarkData = {
    name: document.getElementById('landmark-name').value,
    description: document.getElementById('landmark-description').value,
    photo_url: currentLandmarkMarker.landmarkData ? currentLandmarkMarker.landmarkData.photo_url : ''
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

// Отмена редактирования
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


$('#fetch-yandex-data').on('click', function(){
  const yandexUrl = $('#landmark-yandex-url').val().trim();
  if (!yandexUrl) {
      alert("Введите ссылку с Яндекс.Карт");
      return;
  }
  fetch(fetchYandexDataUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ yandex_url: yandexUrl })
  })
  .then(response => response.json())
  .then(data => {
      if(data.success) {
          // Заполняем поля редактора
          $('#landmark-name').val(data.name);
          $('#landmark-description').val(data.description);
          if(data.photo_url) {
              $('#landmark-photo-preview').html('<img src="' + data.photo_url + '" style="max-height:100px;">');
              if(!currentLandmarkMarker.landmarkData) {
                  currentLandmarkMarker.landmarkData = {};
              }
              currentLandmarkMarker.landmarkData.photo_url = data.photo_url;
          } else {
              $('#landmark-photo-preview').empty();
          }
      } else {
          alert("Ошибка: " + data.error);
      }
  })
  .catch(err => {
      console.error("Ошибка запроса:", err);
      alert("Ошибка получения данных с Яндекс.Карт.");
  });
});

$('#landmark-photo').on('change', function(){
  var fileInput = $(this)[0];
  if(fileInput.files.length > 0) {
      var formData = new FormData();
      formData.append('image', fileInput.files[0]);
      fetch("{{ url_for('upload_landmark_image') }}", {
          method: "POST",
          body: formData
      })
      .then(response => response.json())
      .then(data => {
          if(data.success){
              $('#landmark-photo-preview').html('<img src="' + data.file_url + '" style="max-height:100px;">');
              if(!currentLandmarkMarker.landmarkData){
                  currentLandmarkMarker.landmarkData = {};
              }
              currentLandmarkMarker.landmarkData.photo_url = data.file_url;
          } else {
              alert("Ошибка загрузки изображения для достопримечательности: " + data.error);
          }
      })
      .catch(err => {
          console.error("Ошибка запроса:", err);
          alert("Ошибка загрузки изображения для достопримечательности.");
      });
  }
});


function init() {
    let center;
    const rawValue = document.getElementById('allMarkers').value;
    if ((typeof rawValue === 'string' && rawValue.length > 5)) {
          let markersParsed;
          try {
            markersParsed = JSON.parse(JSON.parse(rawValue));
          } catch(e) {
            console.error("Ошибка двойного парсинга allMarkers:", e);
          }
          if (markersParsed && markersParsed.length > 0) {
            const firstMarker = markersParsed[0];
            const lat = firstMarker?.lat;
            const lng = firstMarker?.lng;
            center = [lat, lng];
          } else {
            center = ['55.755864', '37.617698'];
          }
    } else {
          center = ['55.755864', '37.617698'];
    }

    map = new ymaps.Map("map", {
      center: center,
      zoom: 10
    });

    // Загружаем маркеры из скрытого поля allMarkers
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

    // ЛКМ по карте: добавляем новую точку
    map.events.add("click", function(e) {
      if (!e.get("target") || !e.get("target").geometry) {
        const coords = e.get("coords");
        addMarker({ lat: coords[0], lng: coords[1] }, false);
        updateMultiRoute();
      }
    });

    // ПКМ по карте: создаём новую точку и открываем окно редактирования
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
