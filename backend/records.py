import re

from common import ApiError, MAX_BODY_BYTES, clean, display_date, find, identifier, item_id, json_truth, milliseconds, required, timestamp

OPEN_STATUSES = ("Found", "Pending Claim")
IMAGE_DATA = r"data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+"


def normalize_image(item):
    if not (item.get("image") or "").startswith("http"):
        return item
    name = item["name"].lower()
    images = [
        ("wallet", "wallet"), ("laptop", "laptop"), ("student id", "student-id"),
        ("flask", "flask"), ("bottle", "flask"), ("calculator", "calculator"),
        ("pencil", "pencil-case"), ("phone", "phone"), ("earbud", "phone"),
    ]
    image = next((asset for keyword, asset in images if keyword in name), None)
    if image is None:
        image = "card" if item["category"] == "IDs and Cards" else "document"
    return {**item, "image": f"/items/{image}.svg"}


def visible_item(item, user):
    if not item or (item.get("privacy") == "Held" and item["ownerId"] != user["id"]):
        return None
    item = normalize_image(item)
    if item["ownerId"] == user["id"]:
        return item
    return {key: value for key, value in item.items() if key not in ("answer", "privateNotes", "originalContent")}


def open_found(item):
    return bool(item and item["status"] in OPEN_STATUSES and item.get("privacy") != "Held")


def next_id(records):
    return max(milliseconds(), max((entry["id"] + 1 for entry in records), default=0))


def message_view(message, user_id, other_user_id):
    mine = message["senderId"] == user_id
    return {
        "id": message["id"], "mine": mine, "text": message["text"], "time": message["time"],
        "read": (other_user_id if mine else user_id) in (message.get("readBy") or []),
    }


class Records:
    def __init__(self, store):
        self.store = store
        data = store.data
        self.items = data["items"]
        self.users = data["users"]
        self.claims = data["claims"]
        self.conversations = data["conversations"]
        self.notifications = data["notifications"]
        self.desks = data["desks"]
        self.matches = data["matches"]
        self.answer_attempts = {}

    def item(self, value):
        return find(self.items, id=item_id(value))

    def inbox(self, user):
        return [entry for entry in self.notifications if entry["userId"] == user["id"]]

    def visible_items(self, user, newest_first=False):
        items = sorted(self.items, key=lambda item: item.get("createdAt", ""), reverse=True) if newest_first else self.items
        return [visible for item in items if (visible := visible_item(item, user)) is not None]

    def notify(self, user_id, kind, title, text, target):
        self.notifications.insert(0, {
            "id": identifier("n_"), "userId": user_id, "type": kind, "title": title,
            "text": text, "time": "Just now", "unread": True, "target": target,
        })

    def bootstrap(self, user):
        user_id = user["id"]
        return {
            "items": self.visible_items(user, newest_first=True),
            "claims": [
                claim for claim in self.claims
                if claim["claimantId"] == user_id or (self.item(claim["itemId"]) or {}).get("ownerId") == user_id
            ],
            "conversations": [
                self.conversation_view(thread, user_id)
                for thread in self.conversations if user_id in thread["participantIds"]
            ],
            "notifications": self.inbox(user),
        }

    def create_item(self, user, data, desk=None):
        walk_in = desk is not None
        status = "Found" if walk_in or data.get("status") == "Found" else "Lost"
        image = "" if walk_in else clean(data.get("image"), MAX_BODY_BYTES)
        if image and not re.fullmatch(IMAGE_DATA, image) and not image.startswith("https://images.unsplash.com/"):
            raise ApiError(400, "Upload a PNG, JPEG, WebP, or GIF image.")
        item = {
            "id": next_id(self.items), "name": required(data.get("name"), "Item name", 120),
            "category": required(data.get("category"), "Category", 50),
            "status": status, "date": ("" if walk_in else clean(data.get("date"), 20)) or display_date(),
            "createdAt": timestamp(),
            "location": required(data.get("location"), "Found location" if walk_in else "Location", 160),
            "description": required(data.get("description"), "Public description" if walk_in else "Description", 1500),
            "image": image, "reporter": user["name"], "reporterRole": user["accountType"], "ownerId": user["id"],
        }
        if status == "Found":
            item["question"] = required(data.get("question"), "Ownership question" if walk_in else "Private ownership question", 200)
            item["answer"] = required(data.get("answer"), "Ownership answer" if walk_in else "Private answer", 200).lower()
        else:
            reward = data.get("rewardType")
            item["rewardType"] = reward if reward in ("none", "money", "other") else "none"
            item["rewardAmount"] = clean(data.get("rewardAmount"), 40)
            item["rewardDescription"] = clean(data.get("rewardDescription"), 200)
        if walk_in:
            item["custodyDeskId"] = desk["id"]
            item["privateNotes"] = clean(data.get("privateNotes"), 1500)
            item["shelfTag"] = clean(data.get("shelfTag"), 120)
        else:
            item["mine"] = True
        if item["category"] == "IDs and Cards":
            item["privacy"] = "Held"
        self.items.insert(0, item)
        self.store.save()
        return 201, {"item": item}

    def claimable_item(self, user, value):
        item = self.item(value)
        if not open_found(item):
            raise ApiError(404, "This found item is no longer available to claim.")
        if item["ownerId"] == user["id"]:
            raise ApiError(400, "You cannot claim your own report.")
        return item

    def verify_answer(self, user, value, data):
        item = self.claimable_item(user, value)
        key = (user["id"], item["id"])
        attempts = self.answer_attempts.get(key, 0)
        if attempts >= 5:
            raise ApiError(429, "Too many attempts. Contact the reporter for help.")
        self.answer_attempts[key] = attempts + 1
        if clean(data.get("answer"), 200).lower() != (item.get("answer") or ""):
            raise ApiError(403, "That answer does not match. Check the item details you remember and try again.")
        return 200, {"verified": True}

    def create_claim(self, user, data):
        item = self.claimable_item(user, data.get("itemId"))
        if find(self.claims, itemId=item["id"], claimantId=user["id"], status="Pending"):
            raise ApiError(409, "You already have a pending claim for this item.")
        if not item.get("answer") or clean(data.get("answer"), 200).lower() != item["answer"]:
            raise ApiError(403, "The ownership answer does not match.")
        claim = {
            "id": next_id(self.claims), "itemId": item["id"], "claimant": user["name"],
            "claimantId": user["id"], "accountType": user["accountType"], "status": "Pending",
            "requested": "Just now", "createdAt": timestamp(), "verified": True,
            "explanation": required(data.get("explanation"), "Ownership details", 1200),
            "proof": clean(data.get("proof"), MAX_BODY_BYTES),
        }
        self.claims.insert(0, claim)
        item["status"] = "Pending Claim"
        self.item_thread(item, user["id"])
        self.notify(item["ownerId"], "claim", "New claim request", f"{user['name']} submitted a claim for {item['name']}.", "activity")
        self.store.save()
        return 201, {"claim": claim}

    def claim_and_item(self, value):
        claim = find(self.claims, id=value)
        item = self.item(claim["itemId"]) if claim else None
        if item is None:
            raise ApiError(404, "Claim not found.")
        return claim, item

    def refresh_item_status(self, item):
        item["status"] = "Pending Claim" if find(self.claims, itemId=item["id"], status="Pending") else "Found"

    def review_claim(self, claim, item, status):
        if status not in ("Approved", "Rejected"):
            raise ApiError(400, "Choose Approved or Rejected.")
        if claim["status"] == status:
            return
        if claim["status"] != "Pending" or item["status"] not in (*OPEN_STATUSES, "Claimed"):
            raise ApiError(409, "This claim is no longer open for review.")
        if status == "Approved" and item["status"] == "Claimed":
            raise ApiError(409, "Another claim has already been approved.")
        claim["status"] = status
        if status == "Approved":
            item["approvedClaimantId"] = claim["claimantId"]
            item["status"] = "Claimed"
        elif item["status"] != "Claimed":
            self.refresh_item_status(item)
        self.notify(claim["claimantId"], "claim", f"Claim {status.lower()}", f"Your claim for {item['name']} was {status.lower()}.", "activity")

    def update_claim(self, user, value, data):
        claim, item = self.claim_and_item(value)
        if item["ownerId"] != user["id"]:
            raise ApiError(403, "Only the item reporter can review this claim.")
        self.review_claim(claim, item, data.get("status"))
        self.store.save()
        return 200, {"claim": claim, "item": item}

    def complete_return(self, item):
        if item["status"] == "Returned":
            return
        if item["status"] != "Claimed" or not item.get("approvedClaimantId"):
            raise ApiError(409, "Approve an ownership claim before recording the handover.")
        claims = [claim for claim in self.claims if claim["itemId"] == item["id"]]
        item["returnClaimSnapshot"] = {str(claim["id"]): claim["status"] for claim in claims}
        item["status"] = "Returned"
        self.notify(item["ownerId"], "return", "Item successfully returned", f"{item['name']} was marked as returned.", "activity")
        self.notify(item["approvedClaimantId"], "return", "Handover completed", f"{item['name']} was marked as returned to you.", "activity")
        for claim in claims:
            if claim["claimantId"] != item["approvedClaimantId"] and claim["status"] != "Rejected":
                claim["status"] = "Returned to another claimant"
                self.notify(claim["claimantId"], "return", "Item returned to another claimant", "This item was returned to another claimant.", "activity")

    def update_return(self, user, value, undo):
        item = self.item(value)
        if undo:
            if not item or item["ownerId"] != user["id"] or item["status"] != "Returned":
                raise ApiError(403, "Only the finder can undo a return for their returned item.")
            snapshot = item.pop("returnClaimSnapshot", None) or {}
            for claim in self.claims:
                previous = snapshot.get(str(claim["id"]))
                if claim["itemId"] == item["id"] and previous:
                    claim["status"] = "Pending" if previous == "Approved" else previous
            item.pop("approvedClaimantId", None)
            self.refresh_item_status(item)
            self.notify(item["ownerId"], "return", "Return undone", f"{item['name']} is open for claims again.", "activity")
        else:
            if item is None:
                raise ApiError(404, "Item not found.")
            if item["ownerId"] != user["id"] or item["status"] != "Claimed":
                raise ApiError(403, "Only the reporter can mark an approved claim as returned.")
            self.complete_return(item)
        self.store.save()
        return 200, {"item": item}

    def new_thread(self, item, participants, admin_claim_id=None):
        thread = {"id": next_id(self.conversations), "itemId": item["id"], "participantIds": participants, "messages": []}
        if admin_claim_id is not None:
            thread["adminClaimId"] = admin_claim_id
        self.conversations.insert(0, thread)
        return thread

    def item_thread(self, item, user_id):
        for thread in self.conversations:
            if not thread.get("adminClaimId") and thread["itemId"] == item["id"] and user_id in thread["participantIds"]:
                return thread
        return self.new_thread(item, [item["ownerId"], user_id])

    def conversation_view(self, thread, user_id, reporter=None):
        other_id = next((entry for entry in thread["participantIds"] if entry != user_id), None)
        other = find(self.users, id=other_id) or {}
        messages = [message_view(message, user_id, other_id) for message in thread["messages"]]
        return {
            "id": thread["id"], "itemId": thread["itemId"], "user": other.get("name") or reporter or "ReClaim user",
            "avatar": "RC", "messages": messages,
            "unread": sum(not message["mine"] and not message["read"] for message in messages) if reporter is None else 0,
        }

    def start_conversation(self, user, data):
        item = self.item(data.get("itemId"))
        if not visible_item(item, user):
            raise ApiError(404, "Item not found.")
        if item["ownerId"] == user["id"]:
            raise ApiError(400, "You cannot message yourself.")
        thread = self.item_thread(item, user["id"])
        self.store.save()
        return 201, {"conversation": self.conversation_view(thread, user["id"], item["reporter"])}

    def add_message(self, thread, user_id, text):
        message = {
            "id": next_id(thread["messages"][-1:]), "senderId": user_id,
            "text": text, "time": "Just now", "readBy": [user_id],
        }
        thread["messages"].append(message)
        return message

    def update_conversation(self, user, value, data, read):
        user_id = user["id"]
        thread = find(self.conversations, id=value)
        if not thread or user_id not in thread["participantIds"]:
            raise ApiError(404, "Conversation not found.")
        if read:
            for message in thread["messages"]:
                readers = message.get("readBy") or []
                if user_id not in readers:
                    readers.append(user_id)
                message["readBy"] = readers
            self.store.save()
            return 200, {"ok": True}
        message = self.add_message(thread, user_id, required(data.get("text"), "Message", 2000))
        recipient_id = next((entry for entry in thread["participantIds"] if entry != user_id), None)
        if recipient_id:
            self.notify(recipient_id, "message", "New message", f"{user['name']} sent you a message.", "chat")
        self.store.save()
        return 201, {"message": {"id": message["id"], "mine": True, "text": message["text"], "time": message["time"]}}

    def update_notification(self, user, value, data):
        notification = find(self.notifications, id=value, userId=user["id"])
        if notification is None:
            raise ApiError(404, "Notification not found.")
        notification["unread"] = json_truth(data.get("unread"))
        self.store.save()
        return 200, {"notification": notification}
