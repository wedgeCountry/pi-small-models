# Exercises the Python-specific bare-call ambiguity: Shape is only ever defined as a class, Render
# only ever as a function, and Widget as both — so a bare `Widget()` call can't be honestly resolved
# and must come back "invocation" rather than a guessed "call"/"instantiation".


class Shape:  # fu:Shape=definition
    pass


def Render(obj):  # fu:Render=definition
    return obj


def Widget(x):  # fu:Widget=definition
    return x


class Widget:  # fu:Widget=definition
    pass


Shape()  # fu:Shape=instantiation
Render(1)  # fu:Render=call
Widget()  # fu:Widget=invocation
