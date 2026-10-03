using App.Models.Handler; // fu:Handler=import
using System; // fu:Handler=null

namespace App.Models
{
    public class Handler // fu:Handler=definition
    {
        public Handler(Request req) // fu:Handler=definition
        {
        }
    }

    public class RequestDispatcher
    {
        public void Handler(Request req) // fu:Handler=definition
        {
        }
    }

    public class MyHandler : Handler // fu:Handler=type-reference
    {
    }

    public class Consumer
    {
        private readonly Handler handler; // fu:Handler=type-reference

        public Consumer(Handler handler) // fu:Handler=type-reference
        {
            this.handler = handler;
        }

        public Handler GetHandler() // fu:Handler=type-reference
        {
            return handler;
        }

        public void Process()
        {
            var h = new Handler(); // fu:Handler=instantiation
            Handler.Default(); // fu:Handler=static-access
            registry.Handler(); // fu:Handler=static-access
            Handler(h); // fu:Handler=call
            var fn = Handler; // fu:Handler=reference
        }
    }

    public class HandlerFactory // fu:Handler=null
    {
    }
}
