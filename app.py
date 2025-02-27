from flask import Flask, render_template, request, redirect, url_for, send_file, flash, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, login_required, login_user, logout_user, current_user, UserMixin
from datetime import datetime
import io
import json

app = Flask(__name__)
app.config['SECRET_KEY'] = '322'
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///tourist_routes.db'
db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'

# Пользователь
class User(db.Model, UserMixin):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    avatar_url = db.Column(db.String(300))  # опционально

# Маршрут
class Route(db.Model):
    __tablename__ = 'route'
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(100), nullable=False)
    description = db.Column(db.Text)
    is_private = db.Column(db.Boolean, default=False)
    moderated = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    
    photos = db.relationship('Photo', backref='route', lazy=True)
    comments = db.relationship('Comment', backref='route', lazy=True)
    changes = db.relationship('ChangeHistory', backref='route', lazy=True)
    landmarks = db.relationship('Landmark', backref='route', lazy=True)
    
    points = db.Column(db.Text, nullable=True)
    allMarkers = db.Column(db.Text, nullable=True)
    
    # Отношение к рейтингам
    ratings = db.relationship('Rating', backref='route', lazy='dynamic')
    
    @property
    def ratings_count(self):
        print(self.ratings)
        return self.ratings.count()
        
    
    @property
    def average_rating(self):
        ratings_list = self.ratings.all()
        if ratings_list:
            return round(sum(r.rating for r in ratings_list) / len(ratings_list), 1)
        return 0


# Модель достопримечательности
class Landmark(db.Model):
    __tablename__ = 'landmark'
    id = db.Column(db.Integer, primary_key=True)
    route_id = db.Column(db.Integer, db.ForeignKey('route.id'), nullable=False)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, nullable=True)
    lat = db.Column(db.Float, nullable=False)
    lng = db.Column(db.Float, nullable=False)
    photo_url = db.Column(db.String(300), nullable=True)
    video_url = db.Column(db.String(300), nullable=True)
    yandex_url = db.Column(db.String(300), nullable=True)
    is_featured = db.Column(db.Boolean, default=True)
    auto_fetched = db.Column(db.Boolean, default=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'route_id': self.route_id,
            'name': self.name,
            'description': self.description,
            'lat': self.lat,
            'lng': self.lng,
            'photo_url': self.photo_url,
            'video_url': self.video_url,
            'yandex_url': self.yandex_url,
            'is_featured': self.is_featured,
            'auto_fetched': self.auto_fetched
        }

# Фотографии маршрута
class Photo(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    file_path = db.Column(db.String(200))
    caption = db.Column(db.String(200))
    route_id = db.Column(db.Integer, db.ForeignKey('route.id'))

# Комментарии и оценки
class Comment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.Text, nullable=False)
    rating = db.Column(db.Integer)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    route_id = db.Column(db.Integer, db.ForeignKey('route.id'))

# История изменений маршрута
class ChangeHistory(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    change_desc = db.Column(db.Text)
    changed_at = db.Column(db.DateTime, default=datetime.utcnow)
    route_id = db.Column(db.Integer, db.ForeignKey('route.id'))
    session = db.Column(db.String(100), nullable=True)

# Новая модель для отметок посещения
class Visit(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    route_id = db.Column(db.Integer, db.ForeignKey('route.id'))
    visited_at = db.Column(db.DateTime, default=datetime.utcnow)

# Модель для оценок маршрутов
class Rating(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    route_id = db.Column(db.Integer, db.ForeignKey('route.id'))
    rating = db.Column(db.Integer)

# Модель для лайков
class Like(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    route_id = db.Column(db.Integer, db.ForeignKey('route.id'))

@app.route('/save_markers', methods=['POST'])
def save_markers():
    data = request.get_json()
    route_id = data.get('route_id')
    points = data.get('points', [])
    landmarks = data.get('landmarks', [])
    session_id = data.get('session')
    route = Route.query.get(route_id)
    if not route:
        return jsonify(success=False, error="Маршрут не найден")
    landmark_coords = {(lm["lat"], lm["lng"]) for lm in landmarks}
    filtered_points = [point for point in points if (point["lat"], point["lng"]) not in landmark_coords]
    route.allMarkers = json.dumps(points)
    route.points = json.dumps(filtered_points)
    Landmark.query.filter_by(route_id=route_id).delete()
    for lm in landmarks:
        landmark = Landmark(
            route_id=route_id,
            name=lm.get('name', ''),
            description=lm.get('description', ''),
            lat=lm['lat'],
            lng=lm['lng'],
            photo_url=lm.get('photo_url', '')
        )
        db.session.add(landmark)
    change_desc = f"Автосохранение маркеров. Сессия: {session_id}" if session_id else "Автосохранение маркеров."
    change = ChangeHistory(change_desc=change_desc, route=route, session=session_id)
    db.session.add(change)
    db.session.commit()
    return jsonify(success=True)

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# Главная страница
# Главная страница – передаём словарь с оценками, выставленными текущим пользователем
@app.route('/')
def index():
    if current_user.is_authenticated:
        routes = Route.query.filter((Route.is_private == False) | (Route.user_id == current_user.id)).all()
        user_ratings = {rating.route_id: rating.rating for rating in Rating.query.filter_by(user_id=current_user.id).all()}
    else:
        routes = Route.query.filter_by(is_private=False).all()
        user_ratings = {}
    return render_template('index.html', routes=routes, user_ratings=user_ratings)


# Страница просмотра маршрута – передаём оценку для текущего пользователя, если она есть
@app.route('/route/<int:route_id>')
def view_route(route_id):
    route = Route.query.get_or_404(route_id)
    user_rating = None
    if current_user.is_authenticated:
        rating_obj = Rating.query.filter_by(user_id=current_user.id, route_id=route.id).first()
        user_rating = rating_obj.rating if rating_obj else None
    route_landmarks = [landmark.to_dict() for landmark in route.landmarks]
    return render_template('route_detail.html', route=route, user_rating=user_rating, route_landmarks=route_landmarks)

# Создание нового маршрута
@app.route('/route/new', methods=['GET', 'POST'])
@login_required
def create_route():
    if request.method == 'POST':
        title = request.form.get('title')
        description = request.form.get('description')
        is_private = request.form.get('is_private') == 'on'
        route = Route(title=title, description=description, is_private=is_private, user_id=current_user.id)
        db.session.add(route)
        db.session.commit()
        change = ChangeHistory(change_desc="Маршрут создан", route=route)
        db.session.add(change)
        db.session.commit()
        return redirect(url_for('index'))
    return render_template('create_route.html')

# Редактирование маршрута
@app.route('/route/<int:route_id>/edit', methods=['GET', 'POST'])
@login_required
def edit_route(route_id):
    route = Route.query.get_or_404(route_id)
    if route.user_id != current_user.id:
        flash("Нет доступа к редактированию данного маршрута")
        return redirect(url_for('index'))
    if request.method == 'POST':
        route.title = request.form.get('title')
        route.description = request.form.get('description')
        route.is_private = request.form.get('is_private') == 'on'
        change_desc = "Изменена информация о маршруте"
        change = ChangeHistory(change_desc=change_desc, route=route)
        db.session.add(change)
        db.session.commit()
        flash("Маршрут обновлён")
        return redirect(url_for('index'))
    route_landmarks = [landmark.to_dict() for landmark in route.landmarks]
    return render_template('edit_route.html', route=route, route_landmarks=route_landmarks)

# История изменений маршрута
@app.route('/route/<int:route_id>/history')
@login_required
def route_history(route_id):
    route = Route.query.get_or_404(route_id)
    if route.user_id != current_user.id:
        flash("У вас нет доступа к просмотру истории этого маршрута")
        return redirect(url_for('index'))
    histories = route.changes
    return render_template('history.html', route=route, histories=histories)

# Добавление комментария и оценки
@app.route('/route/<int:route_id>/comment', methods=['POST'])
@login_required
def add_comment(route_id):
    text = request.form.get('text')
    rating = request.form.get('rating', type=int)
    comment = Comment(text=text, rating=rating, user_id=current_user.id, route_id=route_id)
    db.session.add(comment)
    db.session.commit()
    return redirect(url_for('view_route', route_id=route_id))

# Отметка о посещении маршрута
@app.route('/route/<int:route_id>/visit', methods=['POST'])
@login_required
def mark_visit(route_id):
    # Проверяем, если посещение уже отмечено, можно не добавлять повторно
    existing = Visit.query.filter_by(user_id=current_user.id, route_id=route_id).first()
    if not existing:
        visit = Visit(user_id=current_user.id, route_id=route_id)
        db.session.add(visit)
        db.session.commit()
    return jsonify({'status': 'visited'})

# Экспорт маршрута (заглушка)
@app.route('/route/<int:route_id>/export/<format>')
@login_required
def export_route(route_id, format):
    route = Route.query.get_or_404(route_id)
    if route.is_private and route.user_id != current_user.id:
        flash("Нет доступа к приватному маршруту")
        return redirect(url_for('index'))
    if format.lower() == 'gpx':
        data = f"<gpx><trk><name>{route.title}</name></trk></gpx>"
        mime = 'application/gpx+xml'
    elif format.lower() == 'kml':
        data = f"<?xml version='1.0'?><kml><Document><name>{route.title}</name></Document></kml>"
        mime = 'application/vnd.google-earth.kml+xml'
    elif format.lower() == 'kmz':
        data = f"<?xml version='1.0'?><kml><Document><name>{route.title}</name></Document></kml>"
        mime = 'application/vnd.google-earth.kmz'
    else:
        flash("Неподдерживаемый формат экспорта")
        return redirect(url_for('index'))
    return send_file(io.BytesIO(data.encode('utf-8')), mimetype=mime,
                     as_attachment=True, download_name=f"{route.title}.{format}")

# Обработка оценки маршрута
@app.route('/route/<int:route_id>/rate', methods=['POST'])
@login_required
def rate_route(route_id):
    rating_value = request.form.get('rating', type=int)
    if rating_value and 1 <= rating_value <= 5:
        existing = Rating.query.filter_by(user_id=current_user.id, route_id=route_id).first()
        if existing:
            existing.rating = rating_value
        else:
            new_rating = Rating(user_id=current_user.id, route_id=route_id, rating=rating_value)
            db.session.add(new_rating)
        db.session.commit()
    return redirect(request.referrer or url_for('view_route', route_id=route_id))


# AJAX-загрузка комментариев – для каждого комментария получаем оценку из таблицы Rating
@app.route('/route/<int:route_id>/comments')
def route_comments(route_id):
    route = Route.query.get_or_404(route_id)
    ratings = {}
    for comment in route.comments:
         rating_obj = Rating.query.filter_by(user_id=comment.user_id, route_id=route.id).first()
         ratings[comment.id] = rating_obj.rating if rating_obj else None
    return render_template('route_comments.html', route=route, ratings=ratings)

# Личный кабинет пользователя
@app.route('/user/<int:user_id>')
@login_required
def user_profile(user_id):
    user = User.query.get_or_404(user_id)
    comments = Comment.query.filter_by(user_id=user.id).all()
    routes = Route.query.filter_by(user_id=user.id).all()
    return render_template('user_profile.html', user=user, comments=comments, routes=routes)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = User.query.filter_by(username=username).first()
        if user and user.password == password:
            login_user(user)
            return redirect(url_for('index'))
        flash("Неверный логин или пароль")
        return redirect(url_for('login'))
    return render_template('login.html')

@app.route('/register', methods=['POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    username = request.form.get('username')
    password = request.form.get('password')
    confirm_password = request.form.get('confirm_password')
    if password != confirm_password:
        flash("Пароли не совпадают!")
        return redirect(url_for('login'))
    if User.query.filter_by(username=username).first():
        flash("Пользователь с таким именем уже существует!")
        return redirect(url_for('login'))
    new_user = User(username=username, password=password)
    db.session.add(new_user)
    db.session.commit()
    flash("Регистрация успешна! Войдите в систему.")
    return redirect(url_for('login'))

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('index'))

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(host="0.0.0.0", debug=True, port=5050)
