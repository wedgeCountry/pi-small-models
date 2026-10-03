from app.handlers import Handler  # fu:Handler=import
import app.handlers  # fu:Handler=null


class Handler:  # fu:Handler=definition
    pass


class MyHandler(Handler):  # fu:Handler=type-reference
    pass


def process(h: Handler) -> None:  # fu:Handler=type-reference
    pass


def make() -> Handler:  # fu:Handler=type-reference
    pass


items: list[Handler] = []  # fu:Handler=type-reference


def use_handler():
    h = Handler()  # fu:Handler=instantiation
    Handler.default()  # fu:Handler=static-access
    registry.Handler()  # fu:Handler=static-access
    callback = Handler  # fu:Handler=reference
    return h


class HandlerFactory:  # fu:Handler=null
    pass


x = HandlerFactory()  # fu:Handler=null
