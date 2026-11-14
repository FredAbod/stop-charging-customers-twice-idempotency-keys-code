import { app } from "./app.js";
import { provider } from "./fakeProvider.js";

provider.listen(4000, () => console.log("💳 Fake provider on http://localhost:4000"));
app.listen(3000, () => console.log("🛒 Checkout API on http://localhost:3000"));
