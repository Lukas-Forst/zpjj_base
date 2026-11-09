from alembic import context
from app import models  # noqa: F401
from app.config import Settings
from app.db import Base, make_engine

url = context.config.get_main_option("sqlalchemy.url") or Settings.from_env().database_url
engine = make_engine(url)
with engine.connect() as conn:
    context.configure(connection=conn, target_metadata=Base.metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()
