from common import ApiError, clean, display_date, find, identifier, phone_number, required, timestamp
from records import next_id


def is_external(user):
    return user["accountType"] == "External User" or not valid_plm_email(user["email"])


class GuestReports:
    def __init__(self, records):
        self.records = records

    def is_guest_report(self, item):
        return self.records.is_guest_report(item)

    def reference(self, item):
        return f"RCL-{item['id']}"

    def view(self, item):
        return {
            **{key: item[key] for key in ("id", "name", "category", "status", "date", "location", "description")},
            "reference": self.reference(item),
            "kind": item.get("guestKind", "Lost" if item.get("rewardType") or item["status"] == "Lost" else "Found"),
            "messages": item.get("guestMessages") or [],
        }

    def list(self, user):
        return 200, {"reports": [self.view(item) for item in self.records.items if item.get("ownerId") == user["id"]]}

    def submit(self, user, data):
        kind = data.get("kind")
        if kind not in ("Lost", "Found"):
            raise ApiError(400, "Choose Lost or Found.")
        item = {
            "id": next_id(self.records.items), "status": kind, "guestKind": kind, "guestReport": True,
            "ownerId": user["id"], "reporter": required(data.get("contactName"), "Contact name", 100),
            "reporterRole": "External User", "guestEmail": user["email"],
            "guestPhone": phone_number(data["phone"]) if clean(data.get("phone")) else "", "image": "",
            "name": required(data.get("name"), "Item name", 120),
            "category": required(data.get("category"), "Category", 50),
            "location": required(data.get("location"), "Location", 160),
            "description": required(data.get("description"), "Item details", 1500),
            "date": display_date(), "createdAt": timestamp(),
        }
        self.records.items.insert(0, item)
        self.records.store.save()
        return 201, {"report": self.view(item)}

    def message(self, user, value, data, admin=False):
        item = self.records.item(value)
        if not item or not self.is_guest_report(item) or (not admin and item.get("ownerId") != user["id"]):
            raise ApiError(404, "Guest report not found.")
        text = required(data.get("text"), "Message", 2000)
        message = {"id": identifier("g_"), "sender": "Desk" if admin else "Guest", "text": text, "createdAt": timestamp()}
        item.setdefault("guestMessages", []).append(message)
        self.records.store.save()
        return 201, {"report": self.view(item)}

    def handover(self, user, value, data):
        item = self.records.item(value)
        if not item or not self.is_guest_report(item):
            raise ApiError(404, "Guest report not found.")
        if item["status"] == "Returned" and item.get("guestHandover"):
            return 200, {"ok": True}
        if item["status"] != "Lost":
            raise ApiError(409, "Select an open guest lost report.")
        if data.get("idVerified") is not True or data.get("ownershipVerified") is not True:
            raise ApiError(400, "Confirm that valid ID and ownership proof were both checked.")
        recovered = self.records.item(data.get("foundId"))
        if (not recovered or recovered["status"] != "Found" or recovered["category"] != item["category"]
                or recovered.get("ownerId") == item["ownerId"]
                or find(self.records.claims, itemId=recovered["id"], status="Pending")
                or find(self.records.claims, itemId=recovered["id"], status="Approved")):
            raise ApiError(409, "Select a found report in the same category with no pending or approved claims.")
        item["status"] = recovered["status"] = "Returned"
        item["guestHandover"] = {"foundId": recovered["id"], "adminId": user["id"], "verifiedAt": timestamp()}
        recovered["guestHandover"] = {"lostId": item["id"]}
        self.records.notify(recovered["ownerId"], "return", "Handover completed", f"The desk marked {recovered['name']} as returned.", "activity")
        self.records.store.save()
        return 200, {"ok": True}

    def admin_item(self, item):
        if not self.is_guest_report(item):
            return item
        owner = find(self.records.users, id=item.get("ownerId")) or {}
        return {
            **item, "guestReport": True, "guestEmail": item.get("guestEmail") or owner.get("email"),
            "guestPhone": item.get("guestPhone") or owner.get("phone"),
        }
